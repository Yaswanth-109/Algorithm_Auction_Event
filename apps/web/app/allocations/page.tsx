"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { io, Socket } from "socket.io-client";
import { getApiBase } from "../lib/api";
import TeamFlowNav from "../components/team-flow-nav";
import { teamDisplayCode, teamDisplayName } from "../lib/team-labels";

const api=getApiBase();
type CardAssignment={id:string;usesRemaining:number|null;activatedAt:string|null;card:{id:string;name:string;description:string;benefits:string[];conditions:string|null;effectType:string;effectValue:number}};
type ProblemAssignment={status:string;unassignedAt:string|null;problem:{id:string;problemCode:string;title:string;difficulty:string;statement:string;timeLimitSeconds:number;maxScore:number}};
type TeamSnapshot={team:{teamCode:string;name:string;startedAt:string|null;availableCredits:number;cards:CardAssignment[];problems:ProblemAssignment[]};event:{status:string;codingRoundOpen:boolean}|null};

export default function AllocationsPage(){
 const router=useRouter();const [snapshot,setSnapshot]=useState<TeamSnapshot|null>(null);const [loading,setLoading]=useState(true);const [busy,setBusy]=useState(false);const [error,setError]=useState("");
 const load=useCallback(async()=>{const session=await fetch(`${api}/api/auth/session`,{credentials:"include"});if(!session.ok){router.replace("/");return;}const identity=(await session.json()).user as {role:string};if(identity.role!=="TEAM"){router.replace("/admin");return;}const response=await fetch(`${api}/api/team`,{credentials:"include"});const body=await response.json().catch(()=>({}));if(response.status===401){router.replace("/");return;}if(!response.ok)throw new Error(body.error??"Could not load team allotments");if(!body.team.startedAt){router.replace("/dashboard");return;}setSnapshot(body);setError("");setLoading(false);},[router]);
 useEffect(()=>{load().catch(e=>{setError(e instanceof Error?e.message:"Could not load allotments");setLoading(false);});},[load]);
 useEffect(()=>{const socket:Socket=io(api,{withCredentials:true,transports:["websocket"]});socket.on("team.updated",()=>void load());socket.on("event.updated",()=>void load());return()=>{socket.disconnect();};},[load]);
 async function startCoding(){setBusy(true);setError("");try{const response=await fetch(`${api}/api/team/coding-round/start`,{method:"POST",credentials:"include"});const body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(body.error??"The coding round is not ready");router.push("/problems");}catch(e){setError(e instanceof Error?e.message:"Could not start the coding round");}finally{setBusy(false);}}
 if(loading||!snapshot)return <main className="workspace-loading"><div className="loading-mark">A</div><p>LOADING TEAM ALLOTMENTS…</p>{error&&<p className="error-banner">{error}</p>}</main>;
 const {team,event}=snapshot;const assignedProblems=team.problems.filter(row=>!row.unassignedAt);const codingOpen=event?.status==="LIVE"&&event.codingRoundOpen;
 return <main className="dashboard-shell flow-page"><header className="workspace-nav"><a className="brand" href="/dashboard"><span className="brand-mark">A</span> ALGORITHM <b>AUCTION</b></a><span className="flow-page-label">STEP 04 · TEAM ALLOTMENTS</span><button className="text-button" onClick={()=>router.push("/dashboard")}>AUCTION FLOOR ↗</button></header><TeamFlowNav current="allocations" availableCredits={team.availableCredits}/>
  <section className="dashboard-heading"><div><p className="eyebrow"><span/> {teamDisplayName(team.teamCode,team.name).toUpperCase()} / STEP 04</p><h1>Your team’s<br/><em>allotments.</em></h1></div><p className="muted">Review the power cards and algorithms assigned to your team before the coding round.</p></section>
  {error&&<div className="toast-message" role="alert">{error}<button onClick={()=>setError("")}>×</button></div>}
  <section className="allotment-grid personal-allotments">
   <section className="allotment-panel"><div className="allotment-heading"><span className="item-icon">◇</span><h3>YOUR ALLOTTED POWER CARDS</h3><small>{team.cards.length}</small></div>{team.cards.length?team.cards.map(assignment=><article className="personal-allotment-card" key={assignment.id}><span className="section-index">{assignment.activatedAt?"ACTIVATED":"READY TO USE"}</span><h4>{assignment.card.name}</h4><p>{assignment.card.description}</p>{assignment.card.benefits.length>0&&<ul className="benefits">{assignment.card.benefits.map((benefit,index)=><li key={index}>{benefit}</li>)}</ul>}<small>{assignment.usesRemaining===null?"UNLIMITED USES":`${assignment.usesRemaining} USES REMAINING`}</small></article>):<p className="display-empty">No power cards have been allotted to your team yet.</p>}</section>
   <section className="allotment-panel"><div className="allotment-heading"><span className="item-icon">⌘</span><h3>YOUR ALLOTTED ALGORITHMS</h3><small>{assignedProblems.length}</small></div>{assignedProblems.length?assignedProblems.map(assignment=><article className="personal-allotment-card" key={assignment.problem.id}><div className="assigned-top"><span className="section-index">{assignment.problem.problemCode}</span><span className={`problem-status ${assignment.status.toLowerCase()}`}>{assignment.status.replaceAll("_"," ")}</span></div><h4>{assignment.problem.title}</h4><p>{assignment.problem.statement}</p><div className="problem-meta"><span>{Math.floor(assignment.problem.timeLimitSeconds/60)} MIN</span><span>{assignment.problem.maxScore} PTS</span></div></article>):<p className="display-empty">No algorithms have been allotted to your team yet.</p>}</section>
  </section>
  <section className="flow-next-step coding-start-panel"><div><span className="section-index">NEXT · CODING ROUND</span><h2>{codingOpen?"Your team is cleared to code.":"Waiting for the admin to open coding."}</h2><p>{codingOpen?"Start the coding round to open your assigned algorithms.":"The button activates when the event is live and the admin opens the coding round."}</p></div><button className="primary-button" disabled={busy||!codingOpen||assignedProblems.length===0} onClick={()=>void startCoding()}>{busy?"OPENING…":codingOpen?"START CODING ROUND":"WAITING FOR ADMIN"} <b>↗</b></button></section>
  <footer className="workspace-footer"><span>ALGORITHM AUCTION <i>· {teamDisplayCode(team.teamCode,team.name)}</i></span><span>ALLOTMENTS SYNC AUTOMATICALLY <b className="connected">●</b></span></footer>
 </main>;
}
