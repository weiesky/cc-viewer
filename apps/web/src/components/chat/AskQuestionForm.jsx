import React from 'react';
import { Checkbox, Input } from 'antd';
import { t } from '../../i18n';
import { optionAriaLabel, hasOptionDescription } from '../../utils/askOptionDesc';
import AskTimeoutCountdown from './AskTimeoutCountdown';
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

  componentWillUnmount() {}

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
      // submitting 释放由父组件驱动：成功路径 promote 后本组件直接 unmount；
      // PTY abort 路径父组件回滚 pendingAsk 会触发 remount，constructor 自动初始化 submitting=false。
      // 用户卡住时通过下方 Cancel 按钮主动逃生（无任何隐式超时）。
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

          const headerAndQuestion = (
            <>
              {q.header && <span className={styles.askQuestionHeader}>{q.header}</span>}
              <div className={styles.askQuestionText}>{q.question}</div>
            </>
          );

          const optionsBody = (
            <div className={styles.askOptionsBody}>
              {!isMulti ? (
                <div className={styles.askRadioGroup} role="radiogroup">
                  {(q.options || []).map((opt, oi) => {
                    const isOtherOpt = /^other$/i.test(opt.label);
                    const isSelected = isOtherOpt
                      ? otherActive[qi]
                      : !otherActive[qi] && selectedLabel === opt.label;
                    const activate = () => {
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
                    };
                    return (
                      <div
                        key={oi}
                        role="radio"
                        aria-checked={isSelected}
                        tabIndex={0}
                        aria-label={optionAriaLabel(opt)}
                        className={`${styles.askRadioItem}${isSelected ? ' ' + styles.askRadioItemSelected : ''}`}
                        onClick={activate}
                        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); } }}
                      >
                        <span className={styles.askRadioDot}>{isSelected ? '◉' : '○'}</span>
                        <span className={styles.askOptionBody}>
                          <span className={styles.askOptionLabel}>{opt.label}</span>
                          {hasOptionDescription(opt) && <span className={styles.askOptionDesc}>{opt.description}</span>}
                        </span>
                      </div>
                    );
                  })}
                  {!(q.options || []).some(o => /^other$/i.test(o.label)) && (() => {
                    const activate = () => {
                      this.setState(prev => ({
                        otherActive: { ...prev.otherActive, [qi]: true },
                        selections: { ...prev.selections, [qi]: undefined },
                      }));
                    };
                    return (
                      <div
                        role="radio"
                        aria-checked={!!otherActive[qi]}
                        tabIndex={0}
                        aria-label={t('ui.askOther')}
                        className={`${styles.askRadioItem}${otherActive[qi] ? ' ' + styles.askRadioItemSelected : ''}`}
                        onClick={activate}
                        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); } }}
                      >
                        <span className={styles.askRadioDot}>{otherActive[qi] ? '◉' : '○'}</span>
                        <span className={styles.askOptionBody}>
                          <span className={styles.askOptionLabel}>{t('ui.askOther')}</span>
                        </span>
                      </div>
                    );
                  })()}
                </div>
              ) : (
                <div className={styles.askCheckboxGroup} role="group">
                  {(q.options || []).map((opt, oi) => {
                    const checked = !!(multiSelections[qi] && multiSelections[qi].has(opt.label));
                    const activate = () => {
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
                    };
                    return (
                      <div
                        key={oi}
                        role="checkbox"
                        aria-checked={checked}
                        tabIndex={0}
                        aria-label={optionAriaLabel(opt)}
                        className={`${styles.askRadioItem}${checked ? ' ' + styles.askRadioItemSelected : ''}`}
                        onClick={activate}
                        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); } }}
                      >
                        <span className={styles.askRadioDot}>{checked ? '☑' : '☐'}</span>
                        <span className={styles.askOptionBody}>
                          <span className={styles.askOptionLabel}>{opt.label}</span>
                          {hasOptionDescription(opt) && <span className={styles.askOptionDesc}>{opt.description}</span>}
                        </span>
                      </div>
                    );
                  })}
                  {!(q.options || []).some(o => /^other$/i.test(o.label)) && (() => {
                    const activate = () => {
                      this.setState(prev => ({
                        otherActive: { ...prev.otherActive, [qi]: true },
                        multiSelections: { ...prev.multiSelections, [qi]: new Set() },
                      }));
                    };
                    return (
                      <div
                        role="checkbox"
                        aria-checked={!!otherActive[qi]}
                        tabIndex={0}
                        aria-label={t('ui.askOther')}
                        className={`${styles.askRadioItem}${otherActive[qi] ? ' ' + styles.askRadioItemSelected : ''}`}
                        onClick={activate}
                        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); } }}
                      >
                        <span className={styles.askRadioDot}>{otherActive[qi] ? '☑' : '☐'}</span>
                        <span className={styles.askOptionBody}>
                          <span className={styles.askOptionLabel}>{t('ui.askOther')}</span>
                        </span>
                      </div>
                    );
                  })()}
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
                    autoFocus
                  />
                </div>
              )}
            </div>
          );

          return (
            <div key={qi} className={qi < questions.length - 1 ? styles.questionSpacing : undefined}>
              {headerAndQuestion}
              {hasPreview ? (
                <div className={styles.askMarkdownLayout}>
                  {optionsBody}
                  <div className={styles.askMarkdownPreview}>
                    {focusedPreview
                      ? <pre>{focusedPreview}</pre>
                      : <span className={styles.previewPlaceholder}>—</span>
                    }
                  </div>
                </div>
              ) : optionsBody}
            </div>
          );
        })}
        <AskTimeoutCountdown startedAt={this.props.startedAt} timeoutMs={this.props.timeoutMs} />
        <div className={styles.askSubmitRow}>
          {this.props.onCancel && (
            <button
              type="button"
              className={styles.askCancelBtn}
              onClick={() => {
                // cancel 按钮始终可点：删除 30s 强释放 submitting 兜底后，submitting 释放完全依赖
                // 父组件 promote / 回滚触发 unmount/remount —— ws/hook 抖动卡 ack 时若 cancel 也禁用，
                // 用户会被锁死在"提交中…"无逃生口。
                // first-write-wins（ask-store.js markCancelled）保证：answer 已落 disk 后 cancel
                // 会被 noop，server 端不会让前端乐观写覆盖真实 answer。
                this.props.onCancel();
              }}
            >
              {t('ui.askCancel')}
            </button>
          )}
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