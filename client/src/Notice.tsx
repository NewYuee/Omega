import {createRoot} from 'react-dom/client';
import {useAppState} from './AppState.js';

function Notice(){const message=useAppState().notice;return message?<>{message}</>:null}

export function installNotice(){const host=document.getElementById('error');if(!host)return;host.dataset.reactOwned='true';createRoot(host).render(<Notice/>)}
