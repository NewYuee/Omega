import type {GroupStore} from './groups-store.ts';

// Query facts, never hydrate messages or complete group histories for badges.
export function groupAttention(store:GroupStore,offset=0,limit=30){
  const query=`SELECT 'decision:'||t.id id,'decision' kind,t.group_id groupId,t.requirement_id requirementId,t.id taskId,m.thread_id threadId,m.name memberName,g.name groupName,t.title title,t.decision_json decision,t.updated_at updatedAt,NULL pauseKind
    FROM tasks t JOIN requirements r ON r.id=t.requirement_id JOIN groups g ON g.id=t.group_id JOIN group_members m ON m.id=t.member_id
    WHERE t.status='awaiting_input' AND json_extract(t.decision_json,'$.status')='pending' AND r.status NOT IN ('completed','cancelled','accepted')
    UNION ALL
    SELECT 'requirement:'||r.id,'exception',r.group_id,r.id,NULL,g.coordinator_thread_id,NULL,g.name,substr(r.content,1,160),NULL,r.updated_at,r.pause_kind
    FROM requirements r JOIN groups g ON g.id=r.group_id WHERE r.status='paused'
    AND NOT EXISTS(SELECT 1 FROM tasks t WHERE t.requirement_id=r.id AND t.status='awaiting_input' AND json_extract(t.decision_json,'$.status')='pending')`;
  const total=Number(store.db.prepare(`SELECT COUNT(*) n FROM (${query})`).get()?.n||0);
  const items=store.db.prepare(`SELECT * FROM (${query}) ORDER BY updatedAt DESC,id LIMIT ? OFFSET ?`).all(limit,offset).map(row=>({...row,decision:row.decision?JSON.parse(row.decision):null}));
  return{total,items};
}
