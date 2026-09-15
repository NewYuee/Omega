import test from 'node:test';
import assert from 'node:assert/strict';
import {access,readFile} from 'node:fs/promises';
import {declaredVariables} from './helpers/declarations.mjs';

test('TypeScript controllers delegate product views exclusively to React',async()=>{
  for(const file of ['app','transport','platform','attachments','model-settings','groups','group-room','ui']){
    await assert.rejects(access(new URL(`../public/${file}.js`,import.meta.url)));
  }
  const [app,groups,room,styles,ui,chat,header,sidebar,panels,forms,modelSettings,index,attachments,runtime,webBuild,nativeEntry]=await Promise.all([
    readFile(new URL('../client/src/AppController.ts',import.meta.url),'utf8'),
    readFile(new URL('../client/src/groups.ts',import.meta.url),'utf8'),
    readFile(new URL('../client/src/group-room.ts',import.meta.url),'utf8'),
    readFile(new URL('../public/style.css',import.meta.url),'utf8'),
    readFile(new URL('../client/src/ui.ts',import.meta.url),'utf8'),
    readFile(new URL('../client/src/ChatTimeline.tsx',import.meta.url),'utf8'),
    readFile(new URL('../client/src/ConversationHeader.tsx',import.meta.url),'utf8'),
    readFile(new URL('../client/src/WorkspaceSidebar.tsx',import.meta.url),'utf8'),
    readFile(new URL('../client/src/GroupPanels.tsx',import.meta.url),'utf8'),
    readFile(new URL('../client/src/FormLayer.tsx',import.meta.url),'utf8'),
    readFile(new URL('../client/src/model-settings.ts',import.meta.url),'utf8'),
    readFile(new URL('../public/index.html',import.meta.url),'utf8'),
    readFile(new URL('../client/src/attachments.ts',import.meta.url),'utf8'),
    readFile(new URL('../client/src/SessionRuntime.ts',import.meta.url),'utf8'),
    readFile(new URL('../client/build.mjs',import.meta.url),'utf8'),
    readFile(new URL('../native/entry.js',import.meta.url),'utf8'),
  ]);
  assert.doesNotMatch(app,/@ts-nocheck/);
  assert.doesNotMatch(app,/from ['"]\.\/markdown\.js['"]/);
  assert.doesNotMatch(app,/createElement\(['"](?:article|section|details)['"]\)/);
  assert.doesNotMatch(app,/\$\(['"]messages['"]\)/);
  assert.doesNotMatch(app,/history-select|prev-exchange|next-exchange|floating-latest/);
  assert.doesNotMatch(groups,/from ['"]\.\/(?:markdown|avatars)\.js['"]/);
  assert.doesNotMatch(groups,/createElement\(['"]article['"]\)/);
  assert.doesNotMatch(room,/from ['"]\.\/(?:markdown|avatars)\.js['"]/);
  assert.doesNotMatch(room,/createElement\(['"]article['"]\)/);
  assert.doesNotMatch(room,/getElementById\(['"]group-timeline['"]\)|scrollTop|scrollHeight|querySelector/);
  assert.doesNotMatch(groups,/groupHeaderMeta|groupMoreMenu|concurrencySelect|memberPanelToggle|taskPanelToggle/);
  assert.match(groups,/omegaAppState\?\.patch\(\{groupTitle:.*groupHeader:/);
  assert.doesNotMatch(groups,/toggle-glyph/);
  assert.doesNotMatch(groups,/querySelector\(['"]\.group-center['"]\)\?\.prepend/);
  assert.doesNotMatch(groups,/getElementById|querySelector|classList|dataset|replaceChildren|createElement/);
  assert.doesNotMatch(styles,/group-top|requirement-queue|group-actions|task-progress|member-count|group-summary/);
  assert.doesNotMatch(chat,/threadMore|historyRoot|menu\.append\(history\)/);
  assert.match(header,/function ChatMenu/);
  assert.match(header,/function GroupMenu/);
  assert.match(header,/上一组问答.*下一组问答/);
  assert.doesNotMatch(app,/\$\(['"](?:title|section-caption|devices)['"]\)/);
  assert.doesNotMatch(groups,/\$\(['"](?:title|section-caption|group-state|group-description|group-cwd|add-member)['"]\)/);
  assert.doesNotMatch(groups,/\$\(['"](?:show-chats|show-groups|threads|groups|new|new-group|side-caption|mobile-new)['"]\)/);
  assert.doesNotMatch(app,/\$\(['"](?:connection|settings|new|new-group|show-chats|show-groups|side-caption|mobile-new)['"]\)/);
  assert.doesNotMatch(app,/\$\(['"]error['"]\)/);
  assert.doesNotMatch(app,/metricsPanel|\$\(['"]workspace['"]\)/);
  assert.match(sidebar,/function WorkspaceSidebar/);
  assert.match(sidebar,/connectionLabel/);
  assert.match(sidebar,/omega-sidebar-collapsed/);
  assert.doesNotMatch(ui,/MutationObserver|sidebar-collapsed|conversation-drawer|localStorage/);
  assert.doesNotMatch(app,/reactForm|fields:\[/);
  assert.doesNotMatch(groups,/reactForm|memberFields|fields:\[/);
  assert.match(forms,/case'createGroup'/);
  assert.match(forms,/case'member'/);
  assert.match(modelSettings,/openDialog\('modelSettings'/);
  assert.doesNotMatch(index,/class="history-nav"|class="group-top"/);
  assert.doesNotMatch(index,/id="(?:create|create-group-dialog|member-dialog|rename-dialog|delete-dialog|model-dialog)"/);
  assert.match(index,/<aside id="sidebar"><\/aside>/);
  assert.match(index,/<section id="group-view" hidden><\/section>/);
  assert.match(index,/<form id="composer"><\/form>/);
  assert.doesNotMatch(index,/id="(?:group-members|group-tasks|group-summary|member-count|task-progress|group-actions|requirement-form)"/);
  assert.match(panels,/omega:toggle-group-panel/);
  assert.match(chat,/function HistoryImage/);
  assert.match(chat,/function ImageViewer/);
  assert.match(chat,/loadImage\(ref:ImageRef,thumb:boolean,signal:AbortSignal\)/);
  assert.doesNotMatch(app,/attachImages|historyImages|attachments\.prune|replaceChildren/);
  assert.doesNotMatch(attachments,/document\.|getElementById|querySelector|createElement|replaceChildren|historyImages|prune/);
  assert.doesNotMatch(index,/id="image-viewer"|id="image-view"/);
  assert.match(app,/const session=runtime\.session/);
  assert.match(app,/const conversations=runtime\.conversations/);
  assert.match(app,/const timeline=runtime\.timeline/);
  assert.match(app,/session\.reduce\(message\)/);
  const forbidden=new Set(['active','approvals','authenticated','canChangeKey','lastEventId','streamController','refreshTimer','resumeTimer','resuming','unreadThreads','unreadThreadCounts','unreadThreadPositions','threadNames','deletedThreads','items','selectionVersion','outline','selectedTurn','historyMode','historyCursor','turnMetrics','metricsRevision','turnModel','metricsText']);
  assert.deepEqual((await declaredVariables(app)).filter(binding=>forbidden.has(binding.name)),[],'controller must not redeclare React-owned state');
  assert.doesNotMatch(app,/function (?:itemText|renderMetrics|setMetrics)\s*\(/);
  assert.doesNotMatch(app,/function (?:stream|resumeConnection)\s*\(/);
  assert.match(runtime,/function createSession/);
  assert.match(runtime,/function createConversationDirectory/);
  assert.match(runtime,/function createTimeline/);
  assert.match(runtime,/receiveAgentDelta/);
  assert.match(runtime,/hydrationRequest/);
  assert.match(runtime,/function createLifecycle/);
  assert.match(runtime,/reduce\(message:any\):EventEffect/);
  assert.match(webBuild,/replace\('\/app\.js','\/omega-product\.js'\)/);
  assert.match(nativeEntry,/await import\('\.\.\/client\/src\/main\.tsx'\)/);
  assert.doesNotMatch(nativeEntry,/public\/app\.js/);
});
