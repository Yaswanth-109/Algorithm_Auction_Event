"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { io } from "socket.io-client";
import CodeMirror from "@uiw/react-codemirror";
import { python } from "@codemirror/lang-python";
import { java } from "@codemirror/lang-java";
import { cpp } from "@codemirror/lang-cpp";
import * as Y from "yjs";
import { yCollab } from "y-codemirror.next";
import { getApiBase } from "../../lib/api";
import { createIdempotencyKey } from "../../lib/idempotency";

const api=getApiBase();
type Lang="PYTHON"|"JAVA"|"C"|"CPP";
type Workspace={serverNow:number;session:{id:string;startedAt:string;deadlineAt:string;remainingSeconds:number;endedAt:string|null;savedCode:string;language:Lang;revision:number};problem:{id:string;title:string;difficulty:string;statement:string;inputFormat:string;outputFormat:string;constraints:string;sampleExamples:{input:string;output:string;explanation?:string}[];timeLimitSeconds:number;maxScore:number;maxTimingPoints:number;testCases:{input:string;expected:string;position:number}[]}};
type Submission={id:string;status:string;kind:"RUN"|"SUBMIT";score:number;executionMs:number|null;runOutput:string|null;runError:string|null;compileOutput:string|null};
const templates:Record<Lang,string>={
 PYTHON:"import sys\n\ndef solve():\n    data = sys.stdin.read().strip().split()\n    # Write your solution here\n    print()\n\nif __name__ == '__main__':\n    solve()\n",
 JAVA:"import java.io.*;\nimport java.util.*;\n\npublic class Main {\n    public static void main(String[] args) throws Exception {\n        Scanner in = new Scanner(System.in);\n        // Write your solution here\n    }\n}\n",
 C:"#include <stdio.h>\n\nint main(void) {\n    // Write your solution here\n    return 0;\n}\n",
 CPP:"#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    ios::sync_with_stdio(false);\n    cin.tie(nullptr);\n    // Write your solution here\n    return 0;\n}\n",
};
const done=(status:string)=>!["QUEUED","RUNNING"].includes(status);
const asUpdate=(value:unknown):Uint8Array|null=>value instanceof Uint8Array?value:value instanceof ArrayBuffer?new Uint8Array(value):Array.isArray(value)?Uint8Array.from(value as number[]):null;

export default function CodingPage(){
 const params=useParams<{sessionId:string}>();const router=useRouter();const sessionId=params.sessionId;
 const [data,setData]=useState<Workspace|null>(null);const [language,setLanguage]=useState<Lang>("PYTHON");const [revision,setRevision]=useState(0);const [saveState,setSaveState]=useState("LOADING");const [seconds,setSeconds]=useState(0);const [activeMembers,setActiveMembers]=useState<string[]>([]);const [tab,setTab]=useState<"CONSOLE"|"TERMINAL">("CONSOLE");const [customInput,setCustomInput]=useState("");const [submission,setSubmission]=useState<Submission|null>(null);const [runBusy,setRunBusy]=useState(false);const [submitBusy,setSubmitBusy]=useState(false);const [violationMessage,setViolationMessage]=useState("");const [fullscreen,setFullscreen]=useState(false);const [error,setError]=useState("");const [loaded,setLoaded]=useState(false);const wrapper=useRef<HTMLDivElement>(null);const fullscreenRequested=useRef(false);const redirected=useRef(false);const timerAnchor=useRef<{deadlineAt:number;serverNow:number;performanceAt:number}|null>(null);const socketRef=useRef<ReturnType<typeof io>|null>(null);const savedRevision=useRef(0);const saveIndicatorTimer=useRef<ReturnType<typeof setTimeout>|null>(null);const ydoc=useMemo(()=>new Y.Doc(),[]);const ytext=useMemo(()=>ydoc.getText("source"),[ydoc]);
 const extensions=useMemo(()=>[...(language==="PYTHON"?[python()]:language==="JAVA"?[java()]:[cpp()]),yCollab(ytext,null)],[language,ytext]);

 const load=useCallback(async()=>{
  const auth=await fetch(`${api}/api/auth/session`,{credentials:"include"});if(!auth.ok){router.replace("/");return;}
  const identity=(await auth.json()).user;if(identity.role!=="TEAM"){router.replace("/admin");return;}
  const response=await fetch(`${api}/api/team/coding/${sessionId}`,{credentials:"include"});const body=await response.json();if(response.status===409){setError(body.error);router.replace("/problems");return;}if(!response.ok)throw new Error(body.error??"Unable to load coding session");
  const value=body as Workspace;timerAnchor.current={deadlineAt:new Date(value.session.deadlineAt).getTime(),serverNow:value.serverNow,performanceAt:performance.now()};setData(value);setSeconds(value.session.remainingSeconds);setSaveState("CONNECTING TO TEAM EDITOR…");
 },[router,sessionId]);
 useEffect(()=>{load().catch(e=>setError(e.message));},[load]);

 useEffect(()=>{
  if(!data)return;
  const remoteOrigin={};const socket=io(api,{withCredentials:true,transports:["websocket"]});socketRef.current=socket;
  const join=()=>socket.emit("coding:join",sessionId,(result:{ok:boolean;error?:string})=>{if(!result.ok)setError(result.error??"Could not join the shared editor");});
  const sendLocalUpdate=(update:Uint8Array,origin:unknown)=>{if(origin===remoteOrigin)return;if(saveIndicatorTimer.current)clearTimeout(saveIndicatorTimer.current);setSaveState("LIVE · SYNCING…");if(socket.connected)socket.emit("coding:update",{sessionId,update},(result:{ok:boolean;error?:string})=>{if(!result.ok)setError(result.error??"Shared edit was not accepted");});else setSaveState("RECONNECTING…");};
  ydoc.on("update",sendLocalUpdate);
  socket.on("connect",join);
  socket.on("coding:sync",(event:{sessionId:string;update:unknown;language:Lang;revision:number;deadlineAt:string;serverNow:number})=>{if(event.sessionId!==sessionId)return;const update=asUpdate(event.update);if(!update){setError("The shared editor sent an invalid sync update");return;}Y.applyUpdate(ydoc,update,remoteOrigin);timerAnchor.current={deadlineAt:new Date(event.deadlineAt).getTime(),serverNow:event.serverNow,performanceAt:performance.now()};setData(current=>current?{...current,serverNow:event.serverNow,session:{...current.session,deadlineAt:event.deadlineAt}}:current);setSeconds(Math.max(0,Math.ceil((new Date(event.deadlineAt).getTime()-event.serverNow)/1000)));setLanguage(event.language);savedRevision.current=event.revision;setRevision(event.revision);setLoaded(true);setSaveState("LIVE · ALL CHANGES SAVED");socket.emit("coding:update",{sessionId,update:Y.encodeStateAsUpdate(ydoc)});});
  socket.on("coding:update",(event:{sessionId:string;update:unknown})=>{if(event.sessionId!==sessionId)return;const update=asUpdate(event.update);if(!update)return;Y.applyUpdate(ydoc,update,remoteOrigin);});
  socket.on("coding:saved",(event:{sessionId:string;revision:number})=>{if(event.sessionId!==sessionId)return;savedRevision.current=event.revision;if(saveIndicatorTimer.current)clearTimeout(saveIndicatorTimer.current);saveIndicatorTimer.current=setTimeout(()=>{setRevision(savedRevision.current);setSaveState("LIVE · ALL CHANGES SAVED");saveIndicatorTimer.current=null;},350);});
  socket.on("coding:presence",(event:{sessionId:string;members:string[]})=>{if(event.sessionId===sessionId)setActiveMembers(event.members);});
  socket.on("coding:language.updated",(event:{sessionId:string;language:Lang;revision:number})=>{if(event.sessionId!==sessionId)return;setLanguage(event.language);setRevision(event.revision);});
  socket.on("coding:timer.updated",(event:{sessionId:string;deadlineAt:string;serverNow:number})=>{if(event.sessionId!==sessionId)return;timerAnchor.current={deadlineAt:new Date(event.deadlineAt).getTime(),serverNow:event.serverNow,performanceAt:performance.now()};setData(current=>current?{...current,serverNow:event.serverNow,session:{...current.session,deadlineAt:event.deadlineAt}}:current);});
  socket.on("coding:locked",(event:{sessionId:string;error:string})=>{if(event.sessionId===sessionId){setSeconds(0);setError(event.error);setSaveState("TIME EXPIRED");}});
  socket.on("coding:history.reset",(event:{sessionId:string;message:string})=>{if(event.sessionId!==sessionId)return;redirected.current=true;setError(event.message);setSaveState("HISTORY RESET");router.replace("/problems");});
  socket.on("coding:error",(event:{sessionId:string;error:string})=>{if(event.sessionId===sessionId){setError(event.error);setSaveState("SAVE ERROR");}});
  socket.on("disconnect",()=>setSaveState("RECONNECTING…"));
  if(socket.connected)join();
  return()=>{ydoc.off("update",sendLocalUpdate);if(saveIndicatorTimer.current)clearTimeout(saveIndicatorTimer.current);socketRef.current=null;socket.disconnect();};
 },[data?.session.id,sessionId,ydoc,ytext]);

 useEffect(()=>{
  if(!data)return;
  const timer=setInterval(()=>{const anchor=timerAnchor.current;if(!anchor)return;const serverTime=anchor.serverNow+(performance.now()-anchor.performanceAt);const left=Math.max(0,Math.ceil((anchor.deadlineAt-serverTime)/1000));setSeconds(left);if(left===0&&!redirected.current){redirected.current=true;setSaveState("TIME EXPIRED");void fetch(`${api}/api/team/coding/${sessionId}`,{credentials:"include"}).finally(()=>{window.alert("Your time has expired. Your last autosaved code is preserved.");router.replace("/problems");});}},250);
  return()=>clearInterval(timer);
 },[data,router,sessionId]);

 useEffect(()=>{
  const handleFullscreen=()=>{const active=Boolean(document.fullscreenElement);setFullscreen(active);if(fullscreenRequested.current&&!active){fullscreenRequested.current=false;setViolationMessage("Fullscreen exited. This event has been recorded for the administrator.");void fetch(`${api}/api/team/coding/${sessionId}/violation`,{method:"POST",credentials:"include",headers:{"Content-Type":"application/json"},body:JSON.stringify({kind:"FULLSCREEN_EXIT"})});}};
  document.addEventListener("fullscreenchange",handleFullscreen);
  const leaveWarning=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue="Your problem timer continues if you leave this page.";};
  window.addEventListener("beforeunload",leaveWarning);
  return()=>{document.removeEventListener("fullscreenchange",handleFullscreen);window.removeEventListener("beforeunload",leaveWarning);};
 },[sessionId]);

 async function toggleFullscreen(){try{if(!document.fullscreenElement){fullscreenRequested.current=true;await wrapper.current?.requestFullscreen();}else await document.exitFullscreen();}catch{setViolationMessage("Fullscreen could not be opened by this browser.");}}
 async function selectLanguage(next:Lang){if(next===language)return;const currentCode=ytext.toString();if(Object.values(templates).includes(currentCode))ydoc.transact(()=>{ytext.delete(0,ytext.length);ytext.insert(0,templates[next]);});setLanguage(next);setSaveState("LIVE · SYNCING…");setViolationMessage(Object.values(templates).includes(currentCode)?"The team language and starter template were updated for both members.":"The team language changed. Existing shared code was kept.");socketRef.current?.emit("coding:language",{sessionId,language:next},(result:{ok:boolean;error?:string})=>{if(!result.ok)setError(result.error??"Could not change the team language");});}
 async function executeCode(kind:"run"|"submit"){
  if(kind==="run")setRunBusy(true);else setSubmitBusy(true);setError("");setSubmission(null);setTab(kind==="run"?"CONSOLE":"TERMINAL");
  try{
   const currentSource=ytext.toString();const response=await fetch(`${api}/api/team/submissions/${sessionId}/${kind}`,{method:"POST",credentials:"include",headers:{"Content-Type":"application/json","Idempotency-Key":createIdempotencyKey()},body:JSON.stringify({source:currentSource,language,...(kind==="run"&&customInput?{customInput}:{})})});
   const body=await response.json();if(!response.ok)throw new Error(body.error??"Could not queue code");
   const created={id:body.submission.id,status:body.submission.status,kind:kind==="run"?"RUN":"SUBMIT",score:0,executionMs:null,runOutput:null,runError:null,compileOutput:null} as Submission;setSubmission(created);
   for(let i=0;i<100;i++){const statusResponse=await fetch(`${api}/api/team/submissions/${created.id}`,{credentials:"include"});if(!statusResponse.ok)throw new Error("Could not read evaluation result");const statusBody=await statusResponse.json();setSubmission(statusBody.submission);if(done(statusBody.submission.status)){setRunBusy(false);setSubmitBusy(false);if(kind==="submit")setViolationMessage(`Submission complete: ${statusBody.submission.status.replaceAll("_"," ")}. Score: ${statusBody.submission.score}.`);return;}await new Promise(r=>setTimeout(r,800));}
   setError("Evaluation is taking longer than expected. You can check the submission status in the console.");
  }catch(e){setError(e instanceof Error?e.message:"Code execution failed");setRunBusy(false);setSubmitBusy(false);}
 }

 if(!data||!loaded)return <main className="workspace-loading"><div className="loading-mark">⌘</div><p>CONNECTING TO YOUR TEAM’S LIVE EDITOR…</p>{error&&<p>{error}</p>}</main>;
 const minutes=String(Math.floor(seconds/60)).padStart(2,"0"),secs=String(seconds%60).padStart(2,"0");
 return <main className="ide-shell" ref={wrapper}><header className="ide-topbar"><a className="brand" href="/problems"><span className="brand-mark">A</span><b>AUCTION</b></a><div className="ide-problem-title"><b>{data.problem.title}</b></div><div className={`ide-timer ${seconds<60?"urgent":""}`}><i/> {minutes}:{secs}</div><div className="ide-controls"><button className="ide-leaderboard-link" onClick={()=>router.push("/leaderboard")}>LEADERBOARD ↗</button><select value={language} onChange={e=>void selectLanguage(e.target.value as Lang)} aria-label="Programming language"><option value="PYTHON">Python</option><option value="JAVA">Java</option><option value="C">C</option><option value="CPP">C++</option></select><span className="save-indicator"><i/>{saveState}</span><button className="fullscreen-button" onClick={()=>void toggleFullscreen()}>{fullscreen?"EXIT FULLSCREEN":"FULLSCREEN"}</button><button className="ide-submit" disabled={submitBusy||seconds===0} onClick={()=>void executeCode("submit")}>{submitBusy?"SUBMITTING…":"SUBMIT"} <b>↗</b></button></div></header>
 {violationMessage&&<div className="ide-notice" role="status">{violationMessage}<button onClick={()=>setViolationMessage("")}>×</button></div>}{error&&<div className="ide-error" role="alert">{error}<button onClick={()=>setError("")}>×</button></div>}
 <div className="ide-main"><aside className="statement-panel"><div className="statement-scroll"><div className="section-index">PROBLEM STATEMENT</div><h1>{data.problem.title}</h1><div className="statement-meta"><span>{Math.floor(data.problem.timeLimitSeconds/60)} MIN</span><span>{data.problem.maxScore} PTS</span></div><div className="statement-copy">{data.problem.statement.split("\n").map((line,i)=><p key={i}>{line||"\u00a0"}</p>)}</div><h3>Input format</h3><p className="format-text">{data.problem.inputFormat}</p><h3>Output format</h3><p className="format-text">{data.problem.outputFormat}</p><h3>Constraints</h3><pre className="constraints-text">{data.problem.constraints}</pre>{data.problem.testCases.map((sample,index)=><div key={index} className="example-block"><h3>Example {index+1}</h3><div><b>INPUT</b><pre>{sample.input}</pre></div><div><b>OUTPUT</b><pre>{sample.expected}</pre></div></div>)}</div></aside>
 <section className="editor-side"><div className="editor-pane"><div className="editor-topline"><span><i/> main.{language==="PYTHON"?"py":language==="JAVA"?"java":language==="C"?"c":"cpp"}</span><span>LIVE CO-EDITING · {activeMembers.length} ONLINE · REV {revision}</span></div><CodeMirror height="100%" extensions={extensions} theme="dark" basicSetup={{lineNumbers:true,foldGutter:true,autocompletion:true,highlightActiveLine:true,highlightActiveLineGutter:true,indentOnInput:true,bracketMatching:true,closeBrackets:true}}/></div>
 <section className="console-panel"><div className="console-header"><div className="console-tabs"><button className={tab==="CONSOLE"?"active":""} onClick={()=>setTab("CONSOLE")}>CONSOLE</button><button className={tab==="TERMINAL"?"active":""} onClick={()=>setTab("TERMINAL")}>TERMINAL</button></div><div className="console-actions"><span>{submission?submission.status.replaceAll("_"," "):"READY"}</span><button disabled={runBusy||seconds===0} onClick={()=>void executeCode("run")}>{runBusy?"RUNNING…":"▶ RUN"}</button></div></div>
 {tab==="CONSOLE"?<div className="console-body"><label className="custom-input-label">CUSTOM INPUT <small>OPTIONAL · DOES NOT AFFECT SCORE</small></label><textarea className="custom-input" value={customInput} onChange={e=>setCustomInput(e.target.value)} placeholder="Leave empty to run sample test cases"/><div className="result-grid"><div><span>STATUS</span><b>{submission?.status.replaceAll("_"," ")??"NO RUN YET"}</b></div><div><span>EXECUTION</span><b>{submission?.executionMs!==null&&submission?.executionMs!==undefined?`${submission.executionMs} ms`:"—"}</b></div><div><span>OFFICIAL SCORE</span><b>{submission?.kind==="SUBMIT"?submission.score:"—"}</b></div></div><pre className="console-output">{submission?.runOutput||submission?.compileOutput||submission?.runError||"Run your code to see output here."}</pre>{submission?.runError&&<pre className="console-error">{submission.runError}</pre>}</div>:<div className="terminal-output"><div className="terminal-prompt">$ algorithm-auction --session {sessionId.slice(0,8)}</div>{submission?<><p>&gt; evaluation: {submission.status.replaceAll("_"," ")}</p>{submission.executionMs!==null&&<p>&gt; total execution time: {submission.executionMs} ms</p>}{submission.kind==="SUBMIT"&&<p>&gt; earned score: {submission.score}</p>}{submission.compileOutput&&<pre>{submission.compileOutput}</pre>}{submission.runError&&<pre>{submission.runError}</pre>}</>:<p>&gt; Ready. Choose RUN for sample/custom input or SUBMIT for official tests.</p>}</div>}
 </section><footer className="ide-footer"><span>SERVER TIMER · {data.session.startedAt?new Date(data.session.startedAt).toLocaleTimeString():"—"}</span><span>EDITS SYNC LIVE · RECOVERED FROM SERVER SAVES</span><button onClick={()=>router.push("/problems")}>PROBLEM DASHBOARD ↗</button></footer></section></div></main>;
}
