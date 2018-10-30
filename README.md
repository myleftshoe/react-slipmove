# react-slipmove ![CI status](https://img.shields.io/badge/build-passing-brightgreen.svg)

Smoothly animated sortable lists for touch devices. 

## Installation

`npm i react-slipmove`
or
`yarn add react-slipmove`

## [Demo](https://myleftshoe.github.io/react-slipmove-demo/)

```javascript
import React, { Component, PureComponent } from 'react';
import SlipMove from 'react-slipmove';
import './App.css';
import { move, shuffle, reverse } from './array';

const generateItems = length => [...Array(length).keys()].map(k => `Item ${k}`)

const actions = {
  reverse: ({items}) => ({items: reverse(items)}),
  shuffle: ({items}) => ({items: shuffle(items)}),
  move: (oldIndex, newIndex) => ({items}) => ({items: move(items, oldIndex, newIndex)}),
}

export default class extends Component {

  state = { items: generateItems(20) }
  
  move = ({oldIndex, newIndex}) => this.setState(actions.move(oldIndex, newIndex));
  reverse = () => this.setState(actions.reverse);
  shuffle = () => this.setState(actions.shuffle);

  render() {
    const { items } = this.state;
    return (
      <div className="App" >
        <button onClick={this.reverse}>Reverse</button>
        <button onClick={this.shuffle}>Shuffle</button>
        <SlipMove onMoveEnd={this.move} flipMoveProps={{appearAnimation: 'fade'}} >
          {items.map(item => <ListItem key={item}>{item}</ListItem>)}
        </SlipMove>
      </div>
    );
  }
}

// Requires class components as children
class ListItem extends PureComponent {
  render() {
    const { children } = this.props;
    return <div className="list-item" >{children}</div>
  }
}
```

## License
[MIT](https://choosealicense.com/licenses/mit/)