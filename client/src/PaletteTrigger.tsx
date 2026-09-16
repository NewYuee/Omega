import {useEffect,useRef,useState} from 'react';

type Position={x:number;y:number};
const storageKey='omega-palette-position-v1';
function readPosition():Position|null{
  try{const value=JSON.parse(localStorage.getItem(storageKey)||'null');return value&&Number.isFinite(value.x)&&Number.isFinite(value.y)?value:null;}catch{return null;}
}

export function PaletteTrigger({onOpen}:{onOpen:()=>void}){
  const [position,setPosition]=useState(readPosition),[dragging,setDragging]=useState(false);
  const button=useRef<HTMLButtonElement>(null),suppressClick=useRef(false);
  const drag=useRef<{id:number;startX:number;startY:number;origin:Position;moved:boolean}|null>(null);
  const clamp=(value:Position):Position=>{
    const rect=button.current?.getBoundingClientRect();
    return{x:Math.max(8,Math.min(value.x,window.innerWidth-(rect?.width||68)-8)),y:Math.max(8,Math.min(value.y,window.innerHeight-(rect?.height||38)-8))};
  };
  const save=(value:Position)=>{try{localStorage.setItem(storageKey,JSON.stringify(value));}catch{/* Dragging remains available without storage. */}};
  useEffect(()=>{
    const resize=()=>setPosition(value=>value?clamp(value):null);
    resize();window.addEventListener('resize',resize);return()=>window.removeEventListener('resize',resize);
  },[]);
  return <button ref={button} className="omega-palette-trigger" type="button" aria-label="搜索与命令" title="搜索与命令 (⌘/Ctrl K) · 拖动调整位置"
    style={{...(position?{left:position.x,top:position.y,right:'auto',bottom:'auto'}:{}),touchAction:'none',userSelect:'none',cursor:dragging?'grabbing':'grab'}}
    onPointerDown={event=>{
      if(event.button!==0||!event.isPrimary)return;
      const rect=event.currentTarget.getBoundingClientRect();suppressClick.current=false;
      drag.current={id:event.pointerId,startX:event.clientX,startY:event.clientY,origin:{x:rect.left,y:rect.top},moved:false};
      event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onPointerMove={event=>{
      const current=drag.current;if(!current||current.id!==event.pointerId)return;
      const dx=event.clientX-current.startX,dy=event.clientY-current.startY;
      if(!current.moved&&Math.hypot(dx,dy)<5)return;
      current.moved=true;suppressClick.current=true;setDragging(true);
      setPosition(clamp({x:current.origin.x+dx,y:current.origin.y+dy}));
    }}
    onPointerUp={event=>{
      const current=drag.current;if(!current||current.id!==event.pointerId)return;
      if(current.moved){const next=clamp({x:current.origin.x+event.clientX-current.startX,y:current.origin.y+event.clientY-current.startY});setPosition(next);save(next);}
      drag.current=null;setDragging(false);
      if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);
    }}
    onPointerCancel={()=>{drag.current=null;setDragging(false);}}
    onLostPointerCapture={()=>{drag.current=null;setDragging(false);}}
    onClick={event=>{if(event.detail!==0&&suppressClick.current){suppressClick.current=false;return;}onOpen();}}>
    <span>⌕</span><kbd>⌘K</kbd>
  </button>;
}
