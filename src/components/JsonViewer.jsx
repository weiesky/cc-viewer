import React from 'react';
import { JsonView } from 'react-json-view-lite';
import 'react-json-view-lite/dist/index.css';
import styles from './JsonViewer.module.css';

const customStyles = {
  container: 'rjv-container _GzYRV',
  basicChildStyle: '_2bkNM',
  childFieldsContainer: '_1BXBN',
  label: 'rjv-label _3eOF8',
  clickableLabel: 'rjv-label _3eOF8 _1MFti',
  nullValue: 'rjv-null',
  undefinedValue: 'rjv-null',
  stringValue: 'rjv-string',
  booleanValue: 'rjv-keyword',
  numberValue: 'rjv-number',
  otherValue: 'rjv-other',
  punctuation: 'rjv-punct _3eOF8',
  collapseIcon: 'rjv-icon _f10Tu _1MFti _1LId0',
  expandIcon: 'rjv-icon _f10Tu _1MFti _1UmXx',
  collapsedContent: 'rjv-collapsed _1pNG9 _1MFti',
  noQuotesForStringValues: false,
  quotesForFieldNames: false,
  ariaLables: { collapseJson: 'collapse JSON', expandJson: 'expand JSON' },
  stringifyStringValues: false,
};

class JsonViewer extends React.Component {
  shouldComponentUpdate(nextProps) {
    return nextProps.data !== this.props.data || nextProps.defaultExpand !== this.props.defaultExpand || nextProps.expandNode !== this.props.expandNode;
  }

  render() {
    const { data, defaultExpand, expandNode } = this.props;
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
