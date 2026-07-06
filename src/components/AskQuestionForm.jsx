import React from 'react';
import { Checkbox, Input } from 'antd';
import { t } from '../i18n';
import styles from './ChatMessage.module.css';

/**
 * Self-contained AskUserQuestion interactive form.
 * All selection state is local — no parent re-renders during interaction.
 * Only communicates with parent on submit via onSubmit callback.
 */
export default class AskQuestionForm extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      selections: {},       // { qi: selectedLabel }
      multiSelections: {},  // { qi: Set<label> }
      otherActive: {},      // { qi: boolean }
      otherText: {},        // { qi: string }
      submitting: false,
    };
  }

  componentWillUnmount() {
    if (this._submitTimeout) clearTimeout(this._submitTimeout);
  }

  render() {
    const { questions: rawQuestions, onSubmit } = this.props;
    const questions = Array.isArray(rawQuestions) ? rawQuestions : [];
    const { selections, multiSelections, otherActive, otherText, submitting } = this.state;

    const allValid = questions.every((q, qi) => {
      if (otherActive[qi]) return (otherText[qi] || '').trim().length > 0;
      if (q.multiSelect) {
        const set = multiSelections[qi];
        return set && set.size > 0;
      }
      return selections[qi] != null;
    });

    const handleSubmit = () => {
      if (!allValid || submitting) return;
      this.setState({ submitting: true });
      // 超时恢复：30s 后重置提交状态，防止卡在"提交中..."
      // 需覆盖最长路径：hook bridge 等待 3s + PTY prompt 等待 5s + sequential queue 15s
      if (this._submitTimeout) clearTimeout(this._submitTimeout);
      this._submitTimeout = setTimeout(() => {
        this.setState({ submitting: false });
      }, 30000);
      const answers = questions.map((q, qi) => {
        if (otherActive[qi]) {
          const optCount = (q.options || []).length;
          return { questionIndex: qi, type: 'other', optionIndex: optCount, text: (otherText[qi] || '').trim(), isMultiSelect: !!q.multiSelect };
        }
        if (q.multiSelect) {
          const set = multiSelections[qi] || new Set();
          const selectedIndices = [];
          (q.options || []).forEach((opt, oi) => {
            if (set.has(opt.label)) selectedIndices.push(oi);
          });
          return { questionIndex: qi, type: 'multi', selectedIndices };
        }
        const selectedLabel = selections[qi];
        const optionIndex = (q.options || []).findIndex(o => o.label === selectedLabel);
        return { questionIndex: qi, type: 'single', optionIndex };
      });
      if (onSubmit) onSubmit(answers);
    };

    return (
      <div className={styles.askQuestionInteractive}>
        <svg className={`${styles.borderSvg} ${styles.borderSvgInset}`} preserveAspectRatio="none">
          <rect x="0" y="0" width="100%" height="100%" rx="6" ry="6"
            fill="none" stroke="#1668dc" strokeWidth="1" strokeDasharray="6 4"
            className={styles.borderRect} />
        </svg>
        {questions.map((q, qi) => {
          const isMulti = q.multiSelect;
          const hasPreview = !isMulti && q.options?.some(o => o.preview);
          const selectedLabel = selections[qi];
          const focusedPreview = hasPreview && selectedLabel
            ? (q.options.find(o => o.label === selectedLabel) || {}).preview
            : null;

          const optionsContent = (
            <div>
              {q.header && <span className={styles.askQuestionHeader}>{q.header}</span>}
              <div className={styles.askQuestionText}>{q.question}</div>

              {!isMulti ? (
                <div className={styles.askRadioGroup}>
                  {(q.options || []).map((opt, oi) => {
                    const isOtherOpt = /^other$/i.test(opt.label);
                    const isSelected = isOtherOpt
                      ? otherActive[qi]
                      : !otherActive[qi] && selectedLabel === opt.label;
                    return (
                      <div
                        key={oi}
                        className={`${styles.askRadioItem}${isSelected ? ' ' + styles.askRadioItemSelected : ''}`}
                        onClick={() => {
                          if (isOtherOpt) {
                            this.setState(prev => ({
                              otherActive: { ...prev.otherActive, [qi]: true },
                              selections: { ...prev.selections, [qi]: undefined },
                            }));
                          } else {
                            this.setState(prev => ({
                              selections: { ...prev.selections, [qi]: opt.label },
                              otherActive: { ...prev.otherActive, [qi]: false },
                            }));
                          }
                        }}
                      >
                        <span className={styles.askRadioDot}>{isSelected ? '◉' : '○'}</span>
                        {opt.label}
                        {opt.description && <span className={styles.optionDesc}>— {opt.description}</span>}
                      </div>
                    );
                  })}
                  {!(q.options || []).some(o => /^other$/i.test(o.label)) && (
                    <div
                      className={`${styles.askRadioItem}${otherActive[qi] ? ' ' + styles.askRadioItemSelected : ''}`}
                      onClick={() => {
                        this.setState(prev => ({
                          otherActive: { ...prev.otherActive, [qi]: true },
                          selections: { ...prev.selections, [qi]: undefined },
                        }));
                      }}
                    >
                      <span className={styles.askRadioDot}>{otherActive[qi] ? '◉' : '○'}</span>
                      {t('ui.askOther')}
                    </div>
                  )}
                </div>
              ) : (
                <div className={styles.askCheckboxGroup}>
                  {(q.options || []).map((opt, oi) => {
                    const checked = !!(multiSelections[qi] && multiSelections[qi].has(opt.label));
                    return (
                      <div
                        key={oi}
                        className={`${styles.askRadioItem}${checked ? ' ' + styles.askRadioItemSelected : ''}`}
                        onClick={() => {
                          this.setState(prev => {
                            const prevSet = prev.multiSelections[qi] || new Set();
                            const next = new Set(prevSet);
                            if (next.has(opt.label)) next.delete(opt.label);
                            else next.add(opt.label);
                            return {
                              multiSelections: { ...prev.multiSelections, [qi]: next },
                              otherActive: { ...prev.otherActive, [qi]: false },
                            };
                          });
                        }}
                      >
                        <span className={styles.askRadioDot}>{checked ? '☑' : '☐'}</span>
                        {opt.label}
                        {opt.description && <span className={styles.optionDesc}>— {opt.description}</span>}
                      </div>
                    );
                  })}
                  {!(q.options || []).some(o => /^other$/i.test(o.label)) && (
                    <div
                      className={`${styles.askRadioItem}${otherActive[qi] ? ' ' + styles.askRadioItemSelected : ''}`}
                      onClick={() => {
                        this.setState(prev => ({
                          otherActive: { ...prev.otherActive, [qi]: true },
                          multiSelections: { ...prev.multiSelections, [qi]: new Set() },
                        }));
                      }}
                    >
                      <span className={styles.askRadioDot}>{otherActive[qi] ? '☑' : '☐'}</span>
                      {t('ui.askOther')}
                    </div>
                  )}
                </div>
              )}

              {otherActive[qi] && (
                <div className={styles.askOtherInput}>
                  <Input
                    size="small"
                    placeholder={t('ui.askOtherPlaceholder')}
                    value={otherText[qi] || ''}
                    onChange={e => this.setState(prev => ({
                      otherText: { ...prev.otherText, [qi]: e.target.value },
                    }))}
                    onPressEnter={() => { if (allValid && !submitting) handleSubmit(); }}
                    autoFocus
                  />
                </div>
              )}
            </div>
          );

          return (
            <div key={qi} className={qi < questions.length - 1 ? styles.questionSpacing : undefined}>
              {hasPreview ? (
                <div className={styles.askMarkdownLayout}>
                  {optionsContent}
                  <div className={styles.askMarkdownPreview}>
                    {focusedPreview
                      ? <pre>{focusedPreview}</pre>
                      : <span className={styles.previewPlaceholder}>—</span>
                    }
                  </div>
                </div>
              ) : optionsContent}
            </div>
          );
        })}
        <div className={styles.askSubmitRow}>
          <button
            className={styles.askSubmitBtn}
            disabled={!allValid || submitting}
            onClick={handleSubmit}
          >
            {submitting ? t('ui.askSubmitting') : t('ui.askSubmit')}
          </button>
        </div>
      </div>
    );
  }
}