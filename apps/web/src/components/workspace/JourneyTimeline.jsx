import { motion } from 'motion/react';
import { channelStatus } from '../../domain/channels.js';
import Icon from '../Icon.jsx';
import { stages as hospitalStages } from '../../mocks/hospitalClaim.js';
import { basicJourneys } from '../../mocks/basicJourneys.js';
import { stayDays, stayText } from '../../content/format.js';
import { CheckDraw } from '../../motion/primitives.jsx';
import { fadeUp, staggerChildren, transition } from '../../motion/tokens.js';

const serviceIcons = { hospital: 'medical', payment_method_change: 'card', unknown: 'headset' };

/** Index of the step currently in progress, derived from the contract's currentStage. */
export function activeStepIndex(journey, kind) {
  if (journey.currentStage === 'HUMAN_REVIEW') return 1;
  if (kind !== 'hospital') return 2;
  return { EVIDENCE_COLLECTION: 2, READY_FOR_REVIEW: 3, READY_TO_PROCEED: 4 }[journey.currentStage] ?? 2;
}

function hospitalStepText(i, journey) {
  const hospital = journey.claimContext?.hospital;
  const ready = journey.currentStage === 'READY_FOR_REVIEW';
  const proceeding = journey.currentStage === 'READY_TO_PROCEED';
  return [
    '已整理你描述的住院情況。',
    hospital?.partner ? `${hospital.matchedName} 是醫起通合作醫院，可由醫院直接上傳文件。` : hospital ? `無法將「${hospital.mentioned}」對應到醫起通合作院所，可改用理賠聯盟鏈或郵寄申請；若是合作院所，請提供醫院全名。` : '還不知道住院的醫院，上傳診斷書後會再確認。',
    ready || proceeding ? '必要文件已備齊。' : '補齊診斷書或住院證明，以及匯款用的存摺影本。',
    proceeding ? '資料已確認，保險金申請書已填妥。' : ready ? '請確認辨識出的資料，並填寫保險金申請書。' : '文件備齊後進行確認。',
    proceeding ? '選擇申請管道，前往服務入口。' : '資料確認後，選擇醫起通、理賠聯盟鏈或郵寄申請。',
  ][i];
}

function basicStepText(i, journey, basic) {
  if (journey.currentStage === 'HUMAN_REVIEW') return ['已整理你的描述。', '這個情況需要專員確認適用的服務。', '', ''][i] ?? '';
  return ['已整理你的需求。', `已辨識為「${basic.title}」。`, '先備妥右側列出的資料。', '', ''][i] ?? '';
}

function ChannelList({ journey, onProceed, onNavigate }) {
  const { channels, reminders } = journey.claimContext;
  return (
    <motion.div className="channels" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0, transition: transition.enter }}>
      <ul>
        {channels.map(channel => {
          // Having an entry point is not eligibility: each channel says what is still to be confirmed.
          const shown = channelStatus(channel, journey.claimContext.hospital);
          return (
            <li key={channel.id} className={`channel is-${shown.tone}`}>
              <div>
                <strong>{channel.name}</strong>
                {journey.nextAction.target === channel.id && <span className="tag tag-quiet">建議先查看</span>}
                <span className="tag">{shown.tag}</span>
              </div>
              <p>{shown.text}</p>
              {shown.partnerHint && <p>{shown.partnerHint}</p>}
              {shown.toConfirm.length > 0 && (
                <details className="channel-confirm">
                  <summary>仍需確認的條件 {shown.toConfirm.length} 項<Icon name="chevron" size={12} /></summary>
                  <ul>{shown.toConfirm.map(item => <li key={item}>{item}</li>)}</ul>
                </details>
              )}
              {onNavigate && shown.entry === 'navigable' && (
                <button type="button" className="link-button navigate-link" onClick={() => onNavigate(channel.destination)}>
                  <Icon name="external" size={13} />{channel.destination.label}
                </button>
              )}
              {shown.entry === 'unavailable' && <p>這個入口目前無法導覽，請查看官網原文。</p>}
            </li>
          );
        })}
      </ul>
      {reminders.length > 0 && (
        <div className="reminders">
          <p className="section-label"><Icon name="info" size={13} />容易漏掉的提醒</p>
          <ul>{reminders.map(r => <li key={r}>{r}</li>)}</ul>
        </div>
      )}
      <button type="button" className="button button-primary button-small" onClick={onProceed}>前往服務入口<Icon name="arrow" size={15} /></button>
    </motion.div>
  );
}

export default function JourneyTimeline({ snapshot, documentsSlot, onReview, onProceed, onViewService, onNavigate }) {
  const { journey, context } = snapshot;
  const isHospital = context.kind === 'hospital' && journey.currentStage !== 'HUMAN_REVIEW';
  const basic = basicJourneys[journey.currentStage === 'HUMAN_REVIEW' && context.kind !== 'hospital' ? 'unknown' : context.kind] ?? basicJourneys.unknown;
  const stages = context.kind === 'hospital' ? hospitalStages : basic.stages;
  const active = activeStepIndex(journey, context.kind);
  const hospital = journey.claimContext?.hospital;
  const certificate = journey.documents.find(d => d.documentType === 'diagnosis_certificate')?.fields;
  const days = certificate ? stayDays(certificate.admissionDate, certificate.dischargeDate) : null;

  return (
    <section className="panel journey-panel" aria-labelledby="journey-title">
      <header className="panel-header journey-header">
        <div>
          <p className="eyebrow">你的服務旅程</p>
          <h2 id="journey-title" className="journey-service">
            <span className="service-icon"><Icon name={serviceIcons[context.kind] ?? 'route'} size={18} /></span>
            {journey.title}
          </h2>
        </div>
        <span className="live-badge"><span className="pulse-dot" aria-hidden="true" />即時更新</span>
      </header>

      {context.kind === 'hospital' && (
        <div className="trip-strip">
          <div>
            <span>住院醫院</span>
            <strong>{hospital?.matchedName ?? hospital?.mentioned ?? certificate?.hospitalName ?? '待確認'}</strong>
            {hospital && <small className={hospital.partner ? 'strip-note is-ok' : 'strip-note'}>{hospital.partner ? '醫起通合作醫院' : '未對應合作院所'}</small>}
          </div>
          <div>
            <span>{certificate ? '診斷書上的住院期間' : '住院期間'}</span>
            <motion.strong key={days ?? 'pending'} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0, transition: transition.enter }}>
              {days ? `${days} 天` : '待確認'}
            </motion.strong>
            {certificate && <small className="strip-note">{stayText(certificate.admissionDate, certificate.dischargeDate)}</small>}
          </div>
        </div>
      )}

      <motion.ol className="timeline" initial="hidden" animate="show" variants={staggerChildren(0.08, 0.1)}>
        {stages.map((stage, i) => {
          const done = i < active;
          const current = i === active;
          const description = isHospital ? hospitalStepText(i, journey) : basicStepText(i, journey, basic);
          return (
            <motion.li key={stage} variants={fadeUp} className={`step ${done ? 'is-done' : ''} ${current ? 'is-current' : ''}`} aria-current={current ? 'step' : undefined}>
              <span className="step-marker" aria-hidden="true">
                {done ? <CheckDraw size={13} strokeWidth={2.6} /> : <span className="step-number">{i + 1}</span>}
                {current && <span className="step-pulse" />}
              </span>
              <div className="step-body">
                <div className="step-title">
                  <h3>{stage}</h3>
                  <span className="step-state">{done ? '已完成' : current ? '進行中' : '尚未開始'}</span>
                </div>
                {description && <p className="step-text">{description}</p>}

                {isHospital && i === 2 && documentsSlot}

                {isHospital && i === 3 && (journey.currentStage === 'READY_FOR_REVIEW' || journey.currentStage === 'READY_TO_PROCEED') && (
                  <button type="button" className="button button-secondary button-small step-action" onClick={onReview}>
                    {journey.currentStage === 'READY_TO_PROCEED' ? '查看已確認資料' : '確認案件資料'}<Icon name="chevron" size={14} />
                  </button>
                )}

                {isHospital && i === 4 && journey.currentStage === 'READY_TO_PROCEED' && <ChannelList journey={journey} onProceed={onProceed} onNavigate={onNavigate} />}

                {!isHospital && current && journey.currentStage !== 'HUMAN_REVIEW' && basic.steps.length > 0 && (
                  <div className="basic-steps">
                    <ol>{basic.steps.map(step => <li key={step}>{step}</li>)}</ol>
                    <button type="button" className="button button-secondary button-small" onClick={onViewService}>{journey.nextAction.type === 'CONTACT_SPECIALIST' ? '轉由專員協助' : '查看辦理方式'}<Icon name="chevron" size={14} /></button>
                  </div>
                )}
              </div>
            </motion.li>
          );
        })}
      </motion.ol>

      <p className="safe-note"><Icon name="shield" size={15} />{journey.disclaimer}</p>
    </section>
  );
}
