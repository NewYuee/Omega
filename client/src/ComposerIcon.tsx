export function ComposerIcon({kind}:{kind:'image'|'expand'|'sliders'|'send'|'mode'}){
  const paths={image:'M3 3h18v18H3ZM3 17l6-6 4 4 3-3 5 5M7 7h.01',expand:'M14 3h7v7M21 3l-7 7M10 21H3v-7M3 21l7-7',sliders:'M4 7h7m4 0h5M4 17h3m4 0h9M11 4v6M7 14v6',send:'m3 3 18 9-18 9 3-9-3-9ZM6 12h15',mode:'M5 4v16M5 8h8a5 5 0 0 1 5 5v7M14 16l4 4 4-4M1 16l4 4 4-4'};
  return <svg className="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={paths[kind]}/></svg>;
}
