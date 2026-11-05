"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { io, Socket } from "socket.io-client";
import { getApiBase } from "../lib/api";
import TeamFlowNav from "../components/team-flow-nav";
import { teamDisplayCode, teamDisplayName } from "../lib/team-labels";

const api = getApiBase();
type Card = { id:string;name:string;description:string;imageUrl:string|null;benefits:string[];conditions:string|null;effectType:string;effectValue:number };
type Problem = { id:string;problemCode:string;title:string;difficulty:string;statement:string;inputFormat:string;outputFormat:string;constraints:string;sampleExamples:{input:string;output:string;explanation?:string}[];timeLimitSeconds:number;maxScore:number };
type TeamAllocations = { id:string;teamCode:string;name:string;cards:{id:string;name:string}[];problems:{id:string;problemCode:string;title:string;difficulty:string}[] };
type DisplayData = { team:{teamCode:string;name:string;availableCredits:number};featuredCard:Card|null;featuredProblem:Problem|null;teams:TeamAllocations[] };

export default function EventDisplayPage(){
 const router=useRouter();const [data,setData]=useState<DisplayData|null>(null);const [error,setError]=useState("");
 const load=useCallback(async()=>{
  const session=await fetch(`${api}/api/auth/session`,{credentials:"include"});
  if(!session.ok){router.replace("/");return;}
  const identity=(await session.json()).user as {role:string};
  if(identity.role!=="TEAM"){router.replace("/admin");return;}
  const response=await fetch(`${api}/api/team/display`,{credentials:"include"});
  const body=await response.json().catch(()=>({}));
  if(response.status===409){router.replace("/dashboard");return;}
  if(!response.ok)throw new Error(body.error??"Could not load the event display");
  setData(body);setError("");
 },[router]);
 useEffect(()=>{load().catch(e=>setError(e instanceof Error?e.message:"Could not load display"));},[load]);
 useEffect(()=>{const socket:Socket=io(api,{withCredentials:true,transports:["websocket"]});socket.on("event.updated",()=>void load());socket.on("team.updated",()=>void load());return()=>{socket.disconnect();};},[load]);
 if(!data)return <main className="workspace-loading"><div className="loading-mark">A</div><p>LOADING EVENT DISPLAY…</p>{error&&<p className="error-banner">{error}</p>}</main>;
 return <main className="dashboard-shell display-shell">
  <header className="workspace-nav"><a className="brand" href="/dashboard"><span className="brand-mark">A</span> ALGORITHM <b>AUCTION</b></a><span className="flow-page-label">DISPLAYING · {data.featuredCard?"POWER CARD":data.featuredProblem?"ALGORITHM":"NOTHING"}</span><button className="text-button" onClick={()=>router.push("/dashboard")}>AUCTION FLOOR ↗</button></header><TeamFlowNav current="display" availableCredits={data.team.availableCredits}/>
  <section className="dashboard-heading display-title"><div><p className="eyebrow"><span/> STEP 03 / ADMIN SELECTED CONTENT</p><h1>Event<br/><em>spotlight.</em></h1></div><p className="muted">The administrator chooses one published power card or algorithm to spotlight. New selections replace the current display.</p></section>
  {error&&<div className="toast-message" role="alert">{error}</div>}
  <section className="display-feature-grid">
   <article className="display-feature display-feature-single">
    <div className="section-heading"><div><span className="section-index">{data.featuredCard?"POWER CARD DISPLAY":data.featuredProblem?"ALGORITHM DISPLAY":"ADMIN DISPLAY"}</span><h2>{data.featuredCard?.name??data.featuredProblem?.title??"Waiting for admin"}</h2></div><span className="live-label">{data.featuredCard?"DISPLAYING POWER CARD":data.featuredProblem?"DISPLAYING ALGORITHM":"NO SELECTION"}</span></div>
    {data.featuredCard?<div className="display-feature-body">{data.featuredCard.imageUrl&&<img className="display-feature-image" src={`${api}${data.featuredCard.imageUrl}`} alt={data.featuredCard.name}/>}<p>{data.featuredCard.description}</p>{data.featuredCard.benefits.length>0&&<ul className="benefits">{data.featuredCard.benefits.map((benefit,index)=><li key={index}>{benefit}</li>)}</ul>}{data.featuredCard.conditions&&<p className="catalog-condition"><b>CONDITIONS</b> {data.featuredCard.conditions}</p>}</div>:data.featuredProblem?<div className="display-feature-body"><span className="section-index">{data.featuredProblem.problemCode}</span><p className="display-statement">{data.featuredProblem.statement}</p><div className="problem-meta"><span>{Math.floor(data.featuredProblem.timeLimitSeconds/60)} MINUTES</span><span>{data.featuredProblem.maxScore} POINTS</span></div><div className="display-formats"><p><b>INPUT</b>{data.featuredProblem.inputFormat}</p><p><b>OUTPUT</b>{data.featuredProblem.outputFormat}</p><p><b>CONSTRAINTS</b>{data.featuredProblem.constraints}</p></div>{data.featuredProblem.sampleExamples.length>0&&<details className="sample-details"><summary>VIEW SAMPLE CASES</summary>{data.featuredProblem.sampleExamples.map((sample,index)=><div key={index}><b>SAMPLE {index+1}</b><pre>Input: {sample.input}{"\n"}Output: {sample.output}</pre>{sample.explanation&&<p>{sample.explanation}</p>}</div>)}</details>}</div>:<p className="display-empty">The admin has not selected a published power card or algorithm yet.</p>}
   </article>
  </section>  <section className="team-allotments"><div className="section-heading"><div><span className="section-index">TEAM ALLOTMENTS</span><h2>What each team has received</h2></div><span className="live-label">{data.teams.length} TEAMS</span></div><div className="allotment-grid">
   <section className="allotment-panel"><div className="allotment-heading"><span className="item-icon">◇</span><h3>ALLOTTED POWER CARDS</h3></div>{data.teams.map(team=><article className="allotment-team" key={team.id}><div><b>{teamDisplayCode(team.teamCode,team.name)}</b><small>{teamDisplayName(team.teamCode,team.name)}</small></div>{team.cards.length?<ul>{team.cards.map(card=><li key={card.id}>{card.name}</li>)}</ul>:<p>No power cards allotted</p>}</article>)}{!data.teams.length&&<p className="display-empty">No active teams yet.</p>}</section>
   <section className="allotment-panel"><div className="allotment-heading"><span className="item-icon">⌘</span><h3>ALLOTTED ALGORITHMS</h3></div>{data.teams.map(team=><article className="allotment-team" key={team.id}><div><b>{teamDisplayCode(team.teamCode,team.name)}</b><small>{teamDisplayName(team.teamCode,team.name)}</small></div>{team.problems.length?<ul>{team.problems.map(problem=><li key={problem.id}><span>{problem.problemCode} · {problem.title}</span></li>)}</ul>:<p>No algorithms allotted</p>}</article>)}{!data.teams.length&&<p className="display-empty">No active teams yet.</p>}</section>
  </div></section>
  <section className="flow-next-step"><div><span className="section-index">NEXT · STEP 04</span><h2>Review your team allotments.</h2><p>Check your power cards and assigned algorithms before coding starts.</p></div><button className="primary-button" onClick={()=>router.push("/allocations")}>VIEW MY ALLOTMENTS <b>↗</b></button></section>
  <footer className="workspace-footer"><span>ALGORITHM AUCTION <i>· TEAM DISPLAY</i></span><span>UPDATES SYNC AUTOMATICALLY <b className="connected">●</b></span></footer>
 </main>;
}
