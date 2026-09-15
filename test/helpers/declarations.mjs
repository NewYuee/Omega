import {transform} from 'esbuild';
import {parse} from 'acorn';

// Parse TypeScript after erasing types; property reads and strings are not bindings.
export async function declaredVariables(source){
  const {code}=await transform(source,{loader:'ts',target:'esnext'});
  const ast=parse(code,{ecmaVersion:'latest',sourceType:'module'}),bindings=[];
  function bind(pattern,kind){
    if(!pattern)return;
    if(pattern.type==='Identifier')bindings.push({name:pattern.name,kind});
    else if(pattern.type==='ObjectPattern')for(const property of pattern.properties)bind(property.type==='RestElement'?property.argument:property.value,kind);
    else if(pattern.type==='ArrayPattern')for(const element of pattern.elements)bind(element,kind);
    else if(pattern.type==='AssignmentPattern')bind(pattern.left,kind);
    else if(pattern.type==='RestElement')bind(pattern.argument,kind);
  }
  function visit(node){
    if(!node||typeof node!=='object')return;
    if(node.type==='VariableDeclaration')for(const declaration of node.declarations)bind(declaration.id,node.kind);
    for(const value of Object.values(node))if(Array.isArray(value))value.forEach(visit);else if(value&&typeof value==='object')visit(value);
  }
  visit(ast);return bindings;
}
