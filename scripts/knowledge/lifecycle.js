import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync, openSync, fsyncSync, closeSync, renameSync, mkdirSync, lstatSync, existsSync, rmSync, rmdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { projectPublicKnowledge } from '../../shared/publicKnowledge.js';
import { createKnowledgeEngine } from '../../shared/knowledge/index.js';
import { sitePaths } from '../../shared/cardif.js';
import { KnowledgeReleaseSchema, KnowledgeVersionIdSchema, canonicalKnowledgeJson } from '../../shared/knowledge/version.js';
import { inspectPublicText } from '../security/public-artifacts.js';
import fingerprints from '../security/excluded-note-fingerprints.json' with { type: 'json' };
import { evaluateKnowledge, loadKnowledgeDataset } from '../../apps/api/eval/knowledge/runner.js';

export const REVIEW_STATES = ['PENDING', 'APPROVED', 'REJECTED', 'NEEDS_FOLLOWUP'];
export const canonical = canonicalKnowledgeJson;
export const sha256 = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : canonical(value)).digest('hex');
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const fail = message => { throw new Error(message); };
const allowedSources = new Set([...Object.keys(sitePaths), 'https://life.cardif.com.tw/zh/a319']);
const stateSchema = z.enum(REVIEW_STATES);
const timeSchema = z.iso.datetime({ offset: true });
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const versionSchema = KnowledgeVersionIdSchema;
const paragraphSchema = z.object({ id: z.string(), text: z.string(), sha256: hashSchema }).passthrough();
export const ReleaseSchema = KnowledgeReleaseSchema;

export function atomicJson(path, value, mode = 0o600) {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  const fd = openSync(temp, 'wx', mode);
  try {
    try { writeFileSync(fd, JSON.stringify(value, null, 2) + '\n'); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(temp, path); const dir = openSync(dirname(path), 'r'); try { fsyncSync(dir); } finally { closeSync(dir); }
  }
  finally { if (existsSync(temp)) rmSync(temp); }
}
function privateFile(path) {
  const info = lstatSync(path);
  if (!info.isFile() || info.isSymbolicLink() || info.mode & 0o077 || info.uid !== process.getuid()) fail('權限不足：需要目前使用者持有、權限600的本機憑證。');
  return readFileSync(path, 'utf8').trim();
}
function secureStore(store) {
  const info = lstatSync(store);
  if (!info.isDirectory() || info.isSymbolicLink() || info.mode & 0o077 || info.uid !== process.getuid()) fail('Knowledge store 必須是目前使用者的私有0700目錄。');
}
export function initializeStore(store) {
  if (!existsSync(store)) mkdirSync(store, { recursive: true, mode: 0o700 });
  secureStore(store);
  const token = join(store, 'access-token');
  if (!existsSync(token)) writeFileSync(token, randomBytes(32).toString('hex') + '\n', { mode: 0o600, flag: 'wx' });
  return { tokenFile: token, store };
}
function authorize(store, tokenFile) {
  secureStore(store);
  if (!tokenFile) fail('未授權：請提供本機 --token-file。');
  const expected = sha256(privateFile(join(store, 'access-token'))), actual = sha256(privateFile(tokenFile));
  if (!timingSafeEqual(Buffer.from(expected), Buffer.from(actual))) fail('未授權的 Knowledge 操作。');
}
export async function locked(store, tokenFile, operation) {
  authorize(store, tokenFile);
  const lock = join(store, '.write-lock');
  try { mkdirSync(lock, { mode: 0o700 }); } catch { fail('已有 Knowledge 寫入工作；請確認既有操作狀態，不會自動刪除鎖。'); }
  try { return await operation(); } finally { rmdirSync(lock); }
}
const sign = (store, value) => createHmac('sha256', privateFile(join(store, 'access-token'))).update(canonical(value)).digest('hex');
function journal(store) {
  const records = existsSync(join(store, 'audit.json')) ? read(join(store, 'audit.json')) : [];
  let previous = null;
  for (const record of records) {
    const { seal, ...payload } = record;
    if (payload.previous !== previous || seal !== sign(store, payload)) fail('審核紀錄驗證失敗，請勿發布。');
    previous = sha256(record);
  }
  return records;
}
function audit(store, event) {
  const records = journal(store), payload = { ...event, actorUid: process.getuid(), at: new Date().toISOString(), previous: records.length ? sha256(records.at(-1)) : null };
  records.push({ ...payload, seal: sign(store, payload) }); atomicJson(join(store, 'audit.json'), records);
}
function candidates(store) { return existsSync(join(store, 'candidates.json')) ? read(join(store, 'candidates.json')) : []; }
const candidateKey = item => sha256([item.sourceUrl, item.category, item.old?.id ?? null, item.new?.id ?? null, item.old?.sha256 ?? null, item.new?.sha256 ?? null]);
export function importCandidates({ store, tokenFile, report, pages, previousPages = [] }) {
  return locked(store, tokenFile, () => {
    const items = candidates(store), keys = new Set(items.map(candidateKey)); let added = 0;
    for (const change of report.changes) {
      if (!['Added', 'Modified', 'Removed', 'Requires Manual Review'].includes(change.category)) continue;
      if (!allowedSources.has(change.sourceUrl)) fail('候選來源不在官方來源白名單。');
      timeSchema.parse(change.retrievedAt);
      const page = pages.find(p => (p.sourceUrl ?? p.url) === change.sourceUrl);
      if (!page || page.extractionStatus !== 'ok' || sha256(page.content_md) !== page.normalizedContentSha256) fail('缺少有效候選快照。');
      for (const row of [change.old, change.new].filter(Boolean)) {
        paragraphSchema.parse(row); if (sha256(row.text) !== row.sha256) fail('候選段落雜湊不一致。');
      }
      if (change.new && !page.content_md.includes(change.new.text)) fail('候選段落不存在於來源快照。');
      const item = { changeId: change.changeId, category: change.category, sourceId: change.sourceId, sourceUrl: change.sourceUrl,
        retrievedAt: change.retrievedAt, old: change.old ?? null, new: change.new ?? null,
        knowledgeIds: change.knowledgeIds ?? [], navigationTargets: change.navigationTargets ?? [],
        context: page.content_md, previousContext: previousPages.find(p => (p.sourceUrl ?? p.url) === change.sourceUrl)?.content_md ?? null, rawContentSha256: page.rawContentSha256 ?? null, normalizedContentSha256: page.normalizedContentSha256,
        stableParagraphId: change.old?.id ?? change.new?.id ?? null };
      if (keys.has(candidateKey(item))) continue;
      if (items.some(existing => existing.changeId === item.changeId)) fail('候選ID衝突。');
      keys.add(candidateKey(item)); items.push(item); added++;
    }
    atomicJson(join(store, 'candidates.json'), items);
    audit(store, { action: 'IMPORT', added });
    return { added, total: items.length };
  });
}
export function listReviews(store) {
  secureStore(store); const decisions = new Map();
  for (const event of journal(store)) if (event.action === 'REVIEW') decisions.set(event.changeId, event);
  return candidates(store).map(item => {
    const decision = decisions.get(item.changeId);
    if (decision && decision.candidateHash !== sha256(item)) fail('候選完整性驗證失敗。');
    return { ...item, status: decision?.status ?? 'PENDING', decision: decision ?? null };
  });
}
const publicPath = root => join(root, 'data/cardif_public_data.json');
const releasePath = (root, version) => join(root, 'knowledge/releases', `${versionSchema.parse(version)}.json`);
function fieldTarget(snapshot, sourceId, field) {
  const [kind, id] = sourceId.split(':');
  let object;
  if (kind === 'service') object = snapshot.services.find(x => x.id === id);
  if (kind === 'form') object = snapshot.forms.find(x => x.id === id);
  if (kind === 'faq' && /^[1-9]\d*$/.test(id)) object = snapshot.faq[Number(id) - 1];
  if (kind === 'glossary') object = snapshot.glossary.find(x => x.id === id);
  if (!object) fail('Source ID 尚未有既有頁面與導覽錨點；請先交由 Developer A 建立對應。');
  const allowed = { service: ['name', 'notes', 'documents', 'channels', 'online_available', 'apply_time', 'effective_time'], form: ['name', 'note'], faq: ['q', 'a'], glossary: ['term', 'definition'] };
  if (!allowed[kind]?.includes(field)) fail('不可透過知識審核修改ID、URL、導航、權重或商業規則。');
  return object;
}
function validateMapping(snapshot, candidate, mapping, synthetic) {
  const shape = z.object({ sourceId: z.string(), field: z.string(), value: z.union([z.string().min(1), z.array(z.string().min(1))]), entryReviewed: z.literal(true), workflowCompatibility: z.literal('reviewed_no_rule_change') }).strict().parse(mapping);
  const object = fieldTarget(snapshot, shape.sourceId, shape.field);
  const url = object.page ?? object.source ?? object.sourceUrl ?? object.url;
  if (url !== candidate.sourceUrl) fail('候選與Knowledge來源網址不一致。');
  const values = Array.isArray(shape.value) ? shape.value : [shape.value];
  if (candidate.category === 'Removed') {
    const removed = Array.isArray(object[shape.field]) ? object[shape.field].filter(value => !values.includes(value)) : [];
    if (shape.field !== 'notes' || !Array.isArray(shape.value) || !removed.length || !removed.every(value => candidate.old?.text.includes(value) && !candidate.context.includes(value)) || !values.every(value => candidate.context.includes(value))) fail('移除只允許逐筆審核的注意事項；來源ID或應備文件刪除需另行遷移與規則審查。');
  } else if (!candidate.new || !values.length || !values.every(value => candidate.context.includes(value)) || !values.some(value => candidate.new.text.includes(value))) fail('採用內容不是候選來源的原文摘錄。');
  if (!synthetic && /合成測試|SYNTHETIC TEST|NOT A VALID/.test(candidate.new?.text ?? '')) fail('合成候選不得採用至正式 Knowledge。');
  return { ...shape, oldValue: structuredClone(object[shape.field] ?? null), baseSnapshotHash: sha256(snapshot) };
}
export function decide({ root, store, tokenFile, changeId, status, reviewer, reason, mapping, wholePageConfirmed = false, synthetic = false }) {
  return locked(store, tokenFile, () => {
    stateSchema.parse(status);
    if (!reviewer?.trim() || !reason?.trim()) fail('審核者識別與理由不可空白。');
    const item = candidates(store).find(x => x.changeId === changeId); if (!item) fail('找不到候選。');
    if (status === 'APPROVED' && item.category === 'Requires Manual Review' && !wholePageConfirmed) fail('整頁／結構變更必須明確確認，不能自動核准。');
    const reviewOnly = item.category === 'Requires Manual Review';
    const approvedMapping = status === 'APPROVED' && !reviewOnly ? validateMapping(read(publicPath(root)), item, mapping, synthetic) : null;
    audit(store, { action: 'REVIEW', changeId, candidateHash: sha256(item), status, reviewer: reviewer.trim(), reason: reason.trim(), mapping: approvedMapping, synthetic, reviewOnly });
    return { changeId, status };
  });
}
export function validateRelease(value) {
  const release = ReleaseSchema.parse(value), snapshot = projectPublicKnowledge(release.snapshot);
  if (!isDeepStrictEqual(snapshot, release.snapshot) || inspectPublicText(JSON.stringify(snapshot), fingerprints.fingerprints).length) fail('公開快照含有非公開欄位或內部筆記。');
  if (release.syntheticDemo !== Boolean(snapshot.meta.syntheticDemo)) fail('合成資料與版本標記不一致。');
  if (release.snapshotHash !== sha256(snapshot) || snapshot.meta.knowledgeVersion !== release.knowledgeVersion) fail('版本快照雜湊不一致。');
  const engine = createKnowledgeEngine(snapshot, { synthetic: release.syntheticDemo });
  const sources = engine.knowledgeEntries.map(item => ({ sourceId: item.id, sourceUrl: item.sourceUrl, retrievedAt: item.retrievedAt }));
  if (!isDeepStrictEqual(sources, release.sourceManifest)) fail('來源Manifest不一致。');
  for (const entry of engine.knowledgeEntries) {
    if (!allowedSources.has(entry.sourceUrl) || !engine.verifyNavigationDestination(entry.destination, entry.id) || !engine.verifyKnowledgeSource(engine.knowledgeSource(entry))) fail('來源或導航驗證失敗。');
    if (entry.retrievedAt > new Date().toISOString().slice(0, 10)) fail('來源日期不可在未來。');
    if (!entry.content.split('\n').every(line => engine.verifyEvidenceSnippet(entry.id, line))) fail('原文摘錄驗證失敗。');
  }
  return { release, snapshot, engine };
}
function makeRelease(snapshot, previousRelease, approvedChangeIds, synthetic) {
  const plain = structuredClone(snapshot); delete plain.meta.knowledgeVersion;
  if (synthetic) plain.meta.syntheticDemo = true; else delete plain.meta.syntheticDemo;
  const version = `kb-${synthetic ? 'demo-' : ''}${sha256(plain).slice(0, 24)}`;
  plain.meta.knowledgeVersion = version;
  const engine = createKnowledgeEngine(plain, { synthetic });
  return { schemaVersion: 1, knowledgeVersion: version, releasedAt: new Date().toISOString(), approvedChangeIds,
    previousRelease, snapshotHash: sha256(plain), sourceManifest: engine.knowledgeEntries.map(item => ({ sourceId: item.id, sourceUrl: item.sourceUrl, retrievedAt: item.retrievedAt })), syntheticDemo: synthetic, snapshot: plain };
}
async function checkPublication(release, evaluate) {
  const validated = validateRelease(release);
  const metrics = evaluate ? await evaluate(validated.engine) : evaluateKnowledge(await loadKnowledgeDataset(), validated.engine);
  if (metrics.failed || metrics.metrics?.invalidSourceRate?.invalid || metrics.metrics?.invalidRouteRate?.invalid) fail('Knowledge Evaluation未通過；保留原版本。');
  return metrics;
}
function activate(root, release) {
  if (release.syntheticDemo && !existsSync(join(root, '.synthetic-knowledge-demo'))) fail('不得在正式Knowledge啟用合成版本。');
  const target = releasePath(root, release.knowledgeVersion);
  if (existsSync(target)) {
    const existing = validateRelease(read(target)).release;
    if (existing.snapshotHash !== release.snapshotHash) fail('不可覆寫既有版本。');
  } else atomicJson(target, release, 0o644);
  // The one canonical browser/API snapshot is the atomic activation pointer and payload.
  atomicJson(publicPath(root), release.snapshot, 0o644);
}
function commitActivation(root, store, release, event) {
  const before = read(publicPath(root));
  try { activate(root, release); audit(store, event); }
  catch (error) { atomicJson(publicPath(root), before, 0o644); throw error; }
}
export async function bootstrap({ root, store, tokenFile, evaluate }) {
  return locked(store, tokenFile, async () => {
    const snapshot = read(publicPath(root));
    if (snapshot.meta.knowledgeVersion) return status(root);
    if (!isDeepStrictEqual(projectPublicKnowledge(read(join(root, 'data/cardif_seed_data.json'))), snapshot)) fail('未版本化公開快照與Seed不一致，請先審查。');
    const release = makeRelease(snapshot, null, [], false); await checkPublication(release, evaluate);
    commitActivation(root, store, release, { action: 'BOOTSTRAP', version: release.knowledgeVersion });
    return status(root);
  });
}
export function status(root) {
  const snapshot = read(publicPath(root));
  if (!snapshot.meta.knowledgeVersion) return { knowledgeVersion: null, previousRelease: null, status: 'unversioned' };
  const { release } = validateRelease(read(releasePath(root, snapshot.meta.knowledgeVersion)));
  if (release.syntheticDemo !== Boolean(snapshot.meta.syntheticDemo)) fail('合成資料與版本標記不一致。');
  if (release.snapshotHash !== sha256(snapshot)) fail('目前快照不符合已驗證版本。');
  const { snapshot: _snapshot, ...manifest } = release;
  return manifest;
}
export async function publish({ root, store, tokenFile, changeIds, evaluate, synthetic = false }) {
  return locked(store, tokenFile, async () => {
    if (synthetic && !existsSync(join(root, '.synthetic-knowledge-demo'))) fail('合成發布只允許隔離的本機Demo工作目錄。');
    const before = read(publicPath(root)), previous = status(root);
    if (!previous.knowledgeVersion) fail('請先初始化既有公開版本。');
    const reviewed = listReviews(store), requested = changeIds?.length ? changeIds.map(id => reviewed.find(c => c.changeId === id) ?? fail('找不到候選。')) : reviewed.filter(c => c.status === 'APPROVED');
    if (requested.some(item => item.status !== 'APPROVED')) fail('只能發布已核准候選。');
    const selected = requested.filter(item => !item.decision.reviewOnly);
    if (!selected.length) return { adopted: 0, ...previous };
    if (selected.every(item => previous.approvedChangeIds.includes(item.changeId))) return { adopted: 0, ...previous };
    const after = structuredClone(before), fields = new Set();
    for (const item of selected) {
      const d = item.decision;
      if (item.status !== 'APPROVED' || d.candidateHash !== sha256(Object.fromEntries(Object.entries(item).filter(([k]) => !['status', 'decision'].includes(k)))) || Boolean(d.synthetic) !== synthetic) fail('只能發布已核准且完整性有效的候選。');
      if (d.mapping.baseSnapshotHash !== sha256(before)) fail('審核基準已改變，請重新人工審核。');
      const mapping = validateMapping(before, item, Object.fromEntries(Object.entries(d.mapping).filter(([k]) => !['oldValue', 'baseSnapshotHash'].includes(k))), synthetic);
      const key = `${mapping.sourceId}/${mapping.field}`; if (fields.has(key)) fail('同一欄位有衝突的核准變更。'); fields.add(key);
      const target = fieldTarget(after, mapping.sourceId, mapping.field); target[mapping.field] = mapping.value;
      target.retrievedAt = item.retrievedAt.slice(0, 10);
    }
    // Dataset整理日期不冒充逐條擷取日期；取實際採用來源的最近擷取日。
    after.meta.crawled = [before.meta.crawled, ...selected.map(x => x.retrievedAt.slice(0, 10))].sort().at(-1);
    const release = makeRelease(after, previous.knowledgeVersion, selected.map(x => x.changeId), synthetic);
    const oldIds = createKnowledgeEngine(before).knowledgeEntries.map(x => x.id), newIds = createKnowledgeEngine(after).knowledgeEntries.map(x => x.id);
    if (!isDeepStrictEqual(oldIds, newIds)) fail('來源ID／導覽錨點改動需要獨立契約審核。');
    await checkPublication(release, evaluate);
    commitActivation(root, store, release, { action: 'PUBLISH', version: release.knowledgeVersion, approvedChangeIds: release.approvedChangeIds });
    return { adopted: selected.length, ...status(root) };
  });
}
export async function rollback({ root, store, tokenFile, reviewer, reason, version, evaluate }) {
  return locked(store, tokenFile, async () => {
    if (!reviewer?.trim() || !reason?.trim()) fail('回滾需要操作者與理由。');
    const current = status(root), target = version ?? current.previousRelease;
    if (!target) fail('沒有可回滾版本。');
    const release = read(releasePath(root, target)); await checkPublication(release, evaluate);
    commitActivation(root, store, release, { action: 'ROLLBACK', from: current.knowledgeVersion, version: target, reviewer, reason });
    return status(root);
  });
}
export function compareVersions(root, left, right) {
  const a = validateRelease(read(releasePath(root, left))), b = validateRelease(read(releasePath(root, right)));
  return { previousVersion: left, candidateVersion: right, previousHash: a.release.snapshotHash, candidateHash: b.release.snapshotHash,
    changes: b.engine.knowledgeEntries.filter(entry => a.engine.getKnowledgeEntry(entry.id)?.content !== entry.content).map(entry => ({ sourceId: entry.id, before: a.engine.getKnowledgeEntry(entry.id)?.content ?? null, after: entry.content, sourceUrl: entry.sourceUrl, retrievedAt: entry.retrievedAt })) };
}
