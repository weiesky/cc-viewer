import React from 'react';
import { JsonView, darkStyles, defaultStyles } from 'react-json-view-lite';
import 'react-json-view-lite/dist/index.css';
import styles from './JsonViewer.module.css';

class JsonViewer extends React.Component {
  shouldComponentUpdate(nextProps) {
    return nextProps.data !== this.props.data || nextProps.defaultExpand !== this.props.defaultExpand || nextProps.expandNode !== this.props.expandNode;
  }

  render() {
    const { data, defaultExpand, expandNode } = this.props;
    const isDark = typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') !== 'light';
    const customStyles = {
      ...(isDark ? darkStyles : defaultStyles),
      container: 'rjv-container',
    };
    if (data === null || data === undefined) return null;

    const shouldExpandNode = typeof expandNode === 'function'
      ? expandNode
      : defaultExpand === 'all'
        ? () => true
        : defaultExpand === 'root'
          ? (level) => level < 2
          : (level) => level < 1;

    return (
      <div className={styles.container}>
        <JsonView
          data={data}
          shouldExpandNode={shouldExpandNode}
          style={customStyles}
        />
      </div>
    );
  }
}

export default JsonViewer;
