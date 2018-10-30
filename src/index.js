import React, { Component } from 'react';
import PropTypes from 'prop-types';
import Slip from './slip';
import FlipMove from 'react-flip-move';
import './slip.css';

export default class extends Component {

  static propTypes = {
    children: PropTypes.array,
    onMove: PropTypes.func,
    onMoveStart: PropTypes.func,
    disableMove: PropTypes.bool,
    flipMoveProps: PropTypes.object,
    elevateItem: PropTypes.bool,
    style: PropTypes.object
  };

  static defaultProps = {
    elevateItem: true
  }

  state = {
    reordering: false
  }
  
  handleBeforeReorder = e => {
    if (this.props.disableMove) {
        e.preventDefault();
        return;
    }
    this.setState({reordering: true});
    this.props.onMoveStart && this.props.onMoveStart();
  }

  handleReorder = e => {
    const { originalIndex: oldIndex, spliceIndex: newIndex } = e.detail;
    this.props.onMoveEnd && this.props.onMoveEnd({oldIndex, newIndex});
    this.setState({reordering:false});
  }

  container = null;
  init = node => {
    this.container = node;
    new Slip(this.container, { raised: this.props.elevateItem, draggingClassName: 'slipmove-dragging' });
    this.container.addEventListener('slip:beforereorder', this.handleBeforeReorder);
    this.container.addEventListener('slip:reorder', this.handleReorder);    
  }

  componentWillUnmount() {
    this.container.removeEventListener('slip:beforereorder', this.handleBeforeReorder);
    this.container.removeEventListener('slip:reorder', this.handleReorder);    
  }

  render() {
    const { children, flipMoveProps, style = {} } = this.props;
    /*
        'Wrapperless' FlipMove is used here to pass container props down but it requires a
        non static position => override if static or not defined (css defaults to static). 
        (FlipMove overrides it anyway but shows a console warning.)
    */
    if ((style.position || 'static') === 'static') style.position = 'relative'; 
    
    return (
        <div id="container" ref={this.init} style={{...style}}>
            <FlipMove typeName={null} { ...flipMoveProps } disableAllAnimations={this.state.reordering} >
                {children}
            </FlipMove>
        </div>
    );
  }
}

