/*
    Slip - swiping and reordering in lists of elements on touch screens, no fuss.

    Fires these events on list elements:

        • slip:reorder
            Element has been dropped in new location. event.detail contains the following:
                • insertBefore: DOM node before which element has been dropped (null is the end of the list). Use with node.insertBefore().
                • spliceIndex: Index of element before which current element has been dropped, not counting the element iself.
                               For use with Array.splice() if the list is reflecting objects in some array.
                • originalIndex: The original index of the element before it was reordered.

        • slip:beforereorder
            When reordering movement starts.
            Element being reordered gets class `slip-dragging`.
            If you execute event.preventDefault() then the element will not move at all.

        • slip:beforewait
            If you execute event.preventDefault() then reordering will begin immediately, blocking ability to scroll the page.

        • slip:tap
            When element was tapped without being swiped/reordered. You can check `event.target` to limit that behavior to drag handles.


    Usage:

        CSS:
            You should set `user-select:none` (and WebKit prefixes, sigh) on list elements,
            otherwise unstoppable and glitchy text selection in iOS will get in the way.

        list.addEventListener('slip:beforereorder', function(e) {
            if (shouldNotReorder(e.target)) e.preventDefault();
        });

        list.addEventListener('slip:reorder', function(e) {
            // e.target reordered.
            if (reorderedOK) {
                e.target.parentNode.insertBefore(e.target, e.detail.insertBefore);
            } else {
                e.preventDefault();
            }
        });

    Requires:
        • Touch events
        • CSS transforms
        • Function.bind()

    Caveats:
        • Elements must not change size while reordering or swiping takes place (otherwise it will be visually out of sync)
*/
/*! @license
    Slip.js 1.2.0

    © 2014 Kornel Lesiński <kornel@geekhood.net>. All rights reserved.

    Redistribution and use in source and binary forms, with or without modification,
    are permitted provided that the following conditions are met:

    1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.

    2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and
       the following disclaimer in the documentation and/or other materials provided with the distribution.

    THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES,
    INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
    DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
    SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
    SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY,
    WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE
    USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/

export default (function(){

    // -webkit-mess
    const testElementStyle = document.createElement('div').style;

    const transitionJSPropertyName = "transition" in testElementStyle ? "transition" : "webkitTransition";
    const transformJSPropertyName = "transform" in testElementStyle ? "transform" : "webkitTransform";
    const transformCSSPropertyName = transformJSPropertyName === "webkitTransform" ? "-webkit-transform" : "transform";
    const userSelectJSPropertyName = "userSelect" in testElementStyle ? "userSelect" : "webkitUserSelect";

    function Slip(container, options = { raised: true }) {
        if ('string' === typeof container) container = document.querySelector(container);
        if (!container || !container.addEventListener) throw new Error("Please specify DOM node to attach to");
        
        this.options = options;
        
        if (!this || this === window) return new Slip(container);

        // Functions used for as event handlers need usable `this` and must not change to be removable
        this.cancel = this.setState.bind(this, this.states.idle);
        this.onTouchStart = this.onTouchStart.bind(this);
        this.onTouchMove = this.onTouchMove.bind(this);
        this.onTouchEnd = this.onTouchEnd.bind(this);
        this.onMouseDown = this.onMouseDown.bind(this);
        this.onMouseMove = this.onMouseMove.bind(this);
        this.onMouseUp = this.onMouseUp.bind(this);
        this.onMouseLeave = this.onMouseLeave.bind(this);
        this.onSelection = this.onSelection.bind(this);
        this.onContainerFocus = this.onContainerFocus.bind(this);
        this.onContextMenu = this.onContextMenu.bind(this);

        this.setState(this.states.idle);
        this.attach(container);
    }

    function getTransform(node) {
        const transform = node.style[transformJSPropertyName];
        if (transform) {
            return {
                value: transform,
                original: transform,
            };
        }

        if (window.getComputedStyle) {
            const style = window.getComputedStyle(node).getPropertyValue(transformCSSPropertyName);
            if (style && style !== 'none') return {value:style, original:''};
        }
        return {value:'', original:''};
    }

    function findIndex(target, nodes) {
      let originalIndex = 0;
      let listCount = 0;

      for (let i=0; i < nodes.length; i++) {
        if (nodes[i].nodeType === 1) {
          listCount++;
          if (nodes[i] === target.node) {
            originalIndex = listCount-1;
          }
        }
      }

      return originalIndex;
    }

    // All functions in states are going to be executed in context of Slip object
    Slip.prototype = {

        container: null,
        state: null,

        target: null, // the tapped/swiped/reordered node with height and backed up styles

        usingTouch: false, // there's no good way to detect touchscreen preference other than receiving a touch event (really, trust me).
        mouseHandlersAttached: false,

        startPosition: null, // x,y,time where first touch began
        latestPosition: null, // x,y,time where the finger is currently
        previousPosition: null, // x,y,time where the finger was ~100ms ago (for velocity calculation)

        canPreventScrolling: false,

        states: {
            idle: function idleStateInit() {
                this.removeMouseHandlers();
                if (this.target) {
                    this.target.node.style.willChange = '';
                    this.target = null;
                }
                this.usingTouch = false;

                return {
                    allowTextSelection: true,
                };
            },

            undecided: function undecidedStateInit() {

                let node = this.target.node;
                const { marginTop, marginBottom } = window.getComputedStyle(node);
                this.target.height = node.offsetHeight + Math.max(parseInt(marginTop), parseInt(marginBottom));
                node.style.willChange = transformCSSPropertyName;
                node.style[transitionJSPropertyName] = '';
                
                let holdTimer;
                if (!this.dispatch(this.target.originalTarget, 'beforewait')) {
                    if (this.dispatch(this.target.originalTarget, 'beforereorder')) {
                        this.setState(this.states.reorder);
                    }
                } else {
                    holdTimer = setTimeout(function(){
                        const move = this.getAbsoluteMovement();
                        if (this.canPreventScrolling && move.x < 15 && move.y < 25) {
                            if (this.dispatch(this.target.originalTarget, 'beforereorder')) {
                                this.setState(this.states.reorder);
                            }
                        }
                    }.bind(this), 300);
                }

                return {
                    leaveState: function() {
                        clearTimeout(holdTimer);
                    },

                    onMove: function() {
                        const move = this.getAbsoluteMovement();

                        if (move.y > 20) {
                            this.setState(this.states.idle);
                        }

                        // Chrome likes sideways scrolling :(
                        if (move.x > move.y*1.2) return false;
                    },

                    onLeave: function() {
                        this.setState(this.states.idle);
                    },

                    onEnd: function() {
                        const allowDefault = this.dispatch(this.target.originalTarget, 'tap');
                        this.setState(this.states.idle);
                        return allowDefault;
                    },
                };
            },

            reorder: function reorderStateInit() {

                let node = this.target.node;
                node.focus && node.focus();

                const { marginTop, marginBottom } = window.getComputedStyle(node);
                this.target.height = node.offsetHeight + Math.max(parseInt(marginTop), parseInt(marginBottom));
                
                const nodes = this.container.childNodes;
                const originalIndex = findIndex(this.target, nodes);
                let mouseOutsideTimer;
                const zero = node.offsetTop + this.target.height/2;
                const otherNodes = [];
                for(let i=0; i < nodes.length; i++) {
                    if (nodes[i].nodeType !== 1 || nodes[i] === node) continue;
                    const t = nodes[i].offsetTop;
                    nodes[i].style[transitionJSPropertyName] = transformCSSPropertyName + ' 0.2s ease-in-out';
                    if (i > originalIndex)
                        nodes[i].style.willChange = transformCSSPropertyName; 
                    otherNodes.push({
                        node: nodes[i],
                        baseTransform: getTransform(nodes[i]),
                        pos: t + (t < zero ? nodes[i].offsetHeight : 0) - zero,
                    });
                }
                // const nodesArray = Array.prototype.slice.call(nodes);
                // console.log(nodesArray.map(n => n.style.willChange));
                node.classList.add('slip-dragging');
                if (this.options.draggingClassName)
                    node.classList.add(this.options.draggingClassName);
                if (this.options.raised)
                    node.classList.add('slip-shadow');
                node.style.zIndex = '99999';
                node.style[userSelectJSPropertyName] = 'none';

                function onMove() {

                        /*jshint validthis:true */
                    requestAnimationFrame(() => {
                        if (!this.target) return;
                        this.updateScrolling();

                        if (mouseOutsideTimer) {
                            // don't care where the mouse is as long as it moves
                            clearTimeout(mouseOutsideTimer); mouseOutsideTimer = null;
                        }

                        const move = this.getTotalMovement();
                        this.target.node.style[transformJSPropertyName] = 'translate(0,' + move.y + 'px) ' + this.target.baseTransform.value;

                        const height = this.target.height; // +2 for margin
                        otherNodes.forEach(function(o){
                            let off = 0;
                            if (o.pos < 0 && move.y < 0 && o.pos > move.y) {
                                off = height;
                            }
                            else if (o.pos > 0 && move.y > 0 && o.pos < move.y) {
                                off = -height;
                            }
                            // FIXME: should change accelerated/non-accelerated state lazily
                            o.node.style[transformJSPropertyName] = off ? 'translate(0,'+off+'px) ' + o.baseTransform.value : o.baseTransform.original;
                        });
                    });
                    return false;
                }

                onMove.call(this);

                return {
                    leaveState: function() {
                        if (mouseOutsideTimer) clearTimeout(mouseOutsideTimer);

                        if (this.container.focus) {
                            this.container.focus();
                        }

                        // this.target.node.classList.remove('slip-dragging');
                        this.target.node.style[userSelectJSPropertyName] = '';

                        this.animateToZero(function(target){
                            target.node.style.zIndex = '';
                        });
                        otherNodes.forEach(function(o){
                            o.node.style[transformJSPropertyName] = o.baseTransform.original;
                            o.node.style.willChange = null;
                            o.node.style[transitionJSPropertyName] = ''; // FIXME: animate to new position
                        });
                    },

                    onMove: onMove,

                    onLeave: function() {
                        // don't let element get stuck if mouse left the window
                        // but don't cancel immediately as it'd be annoying near window edges
                        if (mouseOutsideTimer) clearTimeout(mouseOutsideTimer);
                        mouseOutsideTimer = setTimeout(function(){
                            mouseOutsideTimer = null;
                            this.cancel();
                        }.bind(this), 700);
                    },

                    onEnd: function() {
                        const move = this.getTotalMovement();
                        let i, spliceIndex;
                        if (move.y < 0) {
                            for (i=0; i < otherNodes.length; i++) {
                                if (otherNodes[i].pos > move.y) {
                                    break;
                                }
                            }
                            spliceIndex = i;
                        } else {
                            for (i=otherNodes.length-1; i >= 0; i--) {
                                if (otherNodes[i].pos < move.y) {
                                    break;
                                }
                            }
                            spliceIndex = i+1;
                        }

                        this.dispatch(this.target.node, 'reorder', {
                            spliceIndex: spliceIndex,
                            originalIndex: originalIndex,
                            insertBefore: otherNodes[spliceIndex] ? otherNodes[spliceIndex].node : null,
                        });

                        this.setState(this.states.idle);
                        return false;
                    },
                };
            },
        },

        attach: function(container) {
            if (this.container) this.detach();

            this.container = container;

            this.container.addEventListener('focus', this.onContainerFocus, {passive:true, capture: false});

            this.otherNodes = [];

            // selection on iOS interferes with reordering
            document.addEventListener("selectionchange", this.onSelection, {passive:false, capture: false});

            // cancel is called e.g. when iOS detects multitasking gesture
            this.container.addEventListener('touchcancel', this.cancel, {passive:true, capture: false});
            this.container.addEventListener('touchstart', this.onTouchStart, {passive:true, capture: false});
            this.container.addEventListener('touchmove', this.onTouchMove, {passive:false, capture: false});
            this.container.addEventListener('touchend', this.onTouchEnd, {passive:false, capture: false});
            this.container.addEventListener('mousedown', this.onMouseDown, {passive:true, capture: false});
            this.container.addEventListener('contextmenu', this.onContextMenu, {passive:false, capture: false});
            // mousemove and mouseup are attached dynamically
        },

        detach: function() {
            this.cancel();

            this.container.removeEventListener('mousedown', this.onMouseDown, {passive:true, capture: false});
            this.container.removeEventListener('touchend', this.onTouchEnd, {passive:false, capture: false});
            this.container.removeEventListener('touchmove', this.onTouchMove, {passive:false, capture: false});
            this.container.removeEventListener('touchstart', this.onTouchStart, {passive:true, capture: false});
            this.container.removeEventListener('touchcancel', this.cancel, {passive:true, capture: false});
            this.container.removeEventListener('contextmenu', this.onContextMenu, {passive:true, capture: false});

            document.removeEventListener("selectionchange", this.onSelection, {passive:false, capture: false});

        },

        setState: function(newStateCtor){
            if (this.state) {
                if (this.state.ctor === newStateCtor) return;
                if (this.state.leaveState) this.state.leaveState.call(this);
            }

            // Must be re-entrant in case ctor changes state
            const prevState = this.state;
            let nextState = newStateCtor.call(this);
            if (this.state === prevState) {
                nextState.ctor = newStateCtor;
                this.state = nextState;
            }
        },

        findTargetNode: function(targetNode) {
            while(targetNode && targetNode.parentNode !== this.container) {
                targetNode = targetNode.parentNode;
            }
            return targetNode;
        },

        onContainerFocus: function(e) {
            e.stopPropagation();
        },

        onSelection: function(e) {
            e.stopPropagation();
            const isRelated = e.target === document || this.findTargetNode(e);
            const iOS = /(iPhone|iPad|iPod)/i.test(navigator.userAgent) && !/(Android|Windows)/i.test(navigator.userAgent);
            if (!isRelated) return;

            if (iOS) {
                // iOS doesn't allow selection to be prevented
                this.setState(this.states.idle);
            } else {
                if (!this.state.allowTextSelection) {
                    e.preventDefault();
                }
            }
        },

        addMouseHandlers: function() {
            // unlike touch events, mousemove/up is not conveniently fired on the same element,
            // but I don't need to listen to unrelated events all the time
            if (!this.mouseHandlersAttached) {
                this.mouseHandlersAttached = true;
                document.documentElement.addEventListener('mouseleave', this.onMouseLeave, {passive:true, capture: false});
                window.addEventListener('mousemove', this.onMouseMove, {passive:false, capture: true});
                window.addEventListener('mouseup', this.onMouseUp, {passive:false, capture: true});
                window.addEventListener('blur', this.cancel, {passive:true, capture: false});
            }
        },

        removeMouseHandlers: function() {
            if (this.mouseHandlersAttached) {
                this.mouseHandlersAttached = false;
                document.documentElement.removeEventListener('mouseleave', this.onMouseLeave, {passive:true, capture: false});
                window.removeEventListener('mousemove', this.onMouseMove, {passive:false, capture: true});
                window.removeEventListener('mouseup', this.onMouseUp, {passive:false, capture: true});
                window.removeEventListener('blur', this.cancel, {passive:true, capture: false});
            }
        },

        onMouseLeave: function(e) {
            e.stopPropagation();
            if (this.usingTouch) return;

            if (e.target === document.documentElement || e.relatedTarget === document.documentElement) {
                if (this.state.onLeave) {
                    this.state.onLeave.call(this);
                }
            }
        },

        onMouseDown: function(e) {
            e.stopPropagation();
            if (this.usingTouch || e.button !== 0 || !this.setTarget(e)) return;

            this.addMouseHandlers(); // mouseup, etc.

            this.canPreventScrolling = true; // or rather it doesn't apply to mouse

            this.startAtPosition({
                x: e.clientX,
                y: e.clientY,
                time: e.timeStamp,
            });
        },

        onTouchStart: function(e) {
            e.stopPropagation();
            this.usingTouch = true;
            this.canPreventScrolling = true;

            // This implementation cares only about single touch
            if (e.touches.length > 1) {
                this.setState(this.states.idle);
                return;
            }

            if (!this.setTarget(e)) return;

            this.startAtPosition({
                x: e.touches[0].clientX,
                y: e.touches[0].clientY,
                time: e.timeStamp,
            });
        },

        setTarget: function(e) {
            const targetNode = this.findTargetNode(e.target);
            if (!targetNode) {
                this.setState(this.states.idle);
                return false;
            }

            //check for a scrollable parent
            let scrollContainer = targetNode.parentNode;
            while (scrollContainer) {
                if (scrollContainer === document.body) break;
                if (scrollContainer.scrollHeight > scrollContainer.clientHeight && window.getComputedStyle(scrollContainer)['overflow-y'] !== 'visible') break;
                scrollContainer = scrollContainer.parentNode;
            }
            scrollContainer = scrollContainer || document.body;

            this.target = {
                originalTarget: e.target,
                node: targetNode,
                scrollContainer: scrollContainer,
                origScrollTop: scrollContainer.scrollTop,
                origScrollHeight: scrollContainer.scrollHeight,
                baseTransform: getTransform(targetNode),
            };
            return true;
        },

        startAtPosition: function(pos) {
            this.startPosition = this.previousPosition = this.latestPosition = pos;
            this.setState(this.states.undecided);
        },

        updatePosition: function(e, pos) {
            if (this.target == null) {
                return;
            }
            this.latestPosition = pos;

            if (this.state.onMove) {
                if (this.state.onMove.call(this) === false) {
                    e.preventDefault();
                }
            }

            // sample latestPosition 100ms for velocity
            if (this.latestPosition.time - this.previousPosition.time > 100) {
                this.previousPosition = this.latestPosition;
            }
        },

        onMouseMove: function(e) {
            e.stopPropagation();
            this.updatePosition(e, {
                x: e.clientX,
                y: e.clientY,
                time: e.timeStamp,
            });
        },

        onTouchMove: function(e) {
            e.stopPropagation();
            this.updatePosition(e, {
                x: e.touches[0].clientX,
                y: e.touches[0].clientY,
                time: e.timeStamp,
            });

            // In Apple's touch model only the first move event after touchstart can prevent scrolling (and event.cancelable is broken)
            this.canPreventScrolling = false;
        },

        onMouseUp: function(e) {
            e.stopPropagation();
            if (this.usingTouch || e.button !== 0) return;

            if (this.state.onEnd && false === this.state.onEnd.call(this)) {
                e.preventDefault();
            }
        },

        onTouchEnd: function(e) {
            e.stopPropagation();
            if (e.touches.length > 1) {
                this.cancel();
            } else if (this.state.onEnd && false === this.state.onEnd.call(this)) {
                e.preventDefault();
            }
        },

        onContextMenu: function(e) {
            e.preventDefault();
            e.stopPropagation();
        },

        getTotalMovement: function() {
            if (!this.target) return;
            const scrollOffset = this.target.scrollContainer.scrollTop - this.target.origScrollTop;
            return {
                x: this.latestPosition.x - this.startPosition.x,
                y: this.latestPosition.y - this.startPosition.y + scrollOffset,
                time: this.latestPosition.time - this.startPosition.time,
            };
        },

        getAbsoluteMovement: function() {
            const move = this.getTotalMovement();
            return {
                x: Math.abs(move.x),
                y: Math.abs(move.y),
                time: move.time,
                directionX: move.x < 0 ? 'left' : 'right',
                directionY: move.y < 0 ? 'up' : 'down',
            };
        },

        updateScrolling: function() {
            let triggerOffset = 40,
                offset = 0;

            const scrollable = this.target.scrollContainer,
                containerRect = scrollable.getBoundingClientRect(),
                targetRect = this.target.node.getBoundingClientRect(),
                bottomOffset = Math.min(containerRect.bottom, window.innerHeight) - targetRect.bottom,
                topOffset = targetRect.top - Math.max(containerRect.top, 0),
                maxScrollTop = this.target.origScrollHeight - Math.min(scrollable.clientHeight, window.innerHeight);

            if (bottomOffset < triggerOffset) {
              offset = Math.min(triggerOffset, triggerOffset - bottomOffset);
            }
            else if (topOffset < triggerOffset) {
              offset = Math.max(-triggerOffset, topOffset - triggerOffset);
            }

            scrollable.scrollTop = Math.max(0, Math.min(maxScrollTop, scrollable.scrollTop + offset));
        },

        dispatch: function(targetNode, eventName, detail) {
            let event = document.createEvent('CustomEvent');
            if (event && event.initCustomEvent) {
                event.initCustomEvent('slip:' + eventName, true, true, detail);
            } else {
                event = document.createEvent('Event');
                event.initEvent('slip:' + eventName, true, true);
                event.detail = detail;
            }
            return targetNode.dispatchEvent(event);
        },

        animateToZero: function(callback, target) {
            // save, because this.target/container could change during animation
            target = target || this.target;
            let node = target.node;
            // target.node.style[transitionJSPropertyName] = transformCSSPropertyName + ' 0.1s ease-out';
            // target.node.style[transitionJSPropertyName] = transformCSSPropertyName + ' 0.0s';
            node.style[transformJSPropertyName] = 'translate(0,0) ' + target.baseTransform.value;
            setTimeout(function(){
                node.style[transitionJSPropertyName] = '';
                node.style[transformJSPropertyName] = target.baseTransform.original;
                node.classList.remove(this.options.draggingClassName);                
                node.classList.remove('slip-dragging');
                node.classList.remove('slip-shadow');
                node.classList.add('slip-dropping');
                const fn = e => {
                    node.classList.remove('slip-dropping');
                    node.removeEventListener("transitionend", fn, false);
                }
                node.addEventListener("transitionend", fn, false);
                if (callback) callback.call(this, target);
            }.bind(this), 100);
        },
    };

    return Slip;
})();
