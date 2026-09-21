export type SlashCommand={name:string;description:string;run():void};

export function slashQuery(text:string){const match=/^\/([^\s/]*)$/.exec(text);return match?.[1].toLowerCase()??null}

export function SlashCommandMenu({commands,active,choose}:{commands:SlashCommand[];active:number;choose(command:SlashCommand):void}){
  return <div className="slash-command-menu" role="listbox" aria-label="可执行操作">
    {commands.map((command,index)=><button type="button" role="option" aria-selected={index===active} key={command.name} onMouseDown={event=>event.preventDefault()} onClick={()=>choose(command)}><strong>/{command.name}</strong><small>{command.description}</small></button>)}
  </div>;
}
