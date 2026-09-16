import {useEffect,useState} from 'react';
import {readAppearance,saveAppearance,type Appearance} from './theme.js';

export function AppearancePanel(){
  const [value,setValue]=useState(readAppearance),[error,setError]=useState('');
  useEffect(()=>{const refresh=()=>setValue(readAppearance());window.addEventListener('omega:appearance-changed',refresh);return()=>window.removeEventListener('omega:appearance-changed',refresh);},[]);
  const change=(next:Appearance)=>{try{saveAppearance(next);setValue(next);setError('');}catch{setError('无法保存外观设置，请检查浏览器是否允许本地存储。');}};
  return <div className="appearance-panel"><h3>外观</h3><p>即时生效，仅保存在当前设备；不改变其他设备的设置。</p>
    <fieldset><legend>显示模式</legend><div className="appearance-options">{([['system','跟随系统'],['light','浅色'],['dark','深色']] as const).map(([mode,label])=><label key={mode}><input type="radio" name="appearance-mode" value={mode} checked={value.mode===mode} onChange={()=>change({...value,mode})}/>{label}</label>)}</div></fieldset>
    <fieldset><legend>强调色</legend><div className="appearance-options">{([['green','Omega 绿'],['blue','蓝色'],['purple','紫色'],['amber','琥珀色']] as const).map(([accent,label])=><label key={accent}><input type="radio" name="appearance-accent" value={accent} checked={value.accent===accent} onChange={()=>change({...value,accent})}/><span className={`appearance-swatch swatch-${accent}`} aria-hidden="true"/>{label}</label>)}</div></fieldset>
    <section className="appearance-preview" aria-label="主题预览"><strong>预览</strong><p>消息正文与背景保持清晰对比，强调色用于按钮、链接和选中状态。</p><a href="#appearance-preview" onClick={event=>event.preventDefault()}>链接示例</a><pre><code>const message = '你好，Omega';</code></pre><button type="button" disabled>按钮预览</button><p className="appearance-warning">警告和错误颜色独立，不随强调色改变。</p></section>
    {error&&<p role="alert">{error}</p>}
  </div>;
}
