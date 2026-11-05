"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { io, Socket } from "socket.io-client";
import { getApiBase } from "../lib/api";
import TeamFlowNav from "../components/team-flow-nav";

const api=getApiBase();
type Card={id:string;name:string;description:string;imageUrl:string|null;benefits:string[];conditions:string|null;usageLimit:number|null;effectType:string;effectValue:number};
type Problem={id:string;problemCode:string;title:string;difficulty:string;statement:string;inputFormat:string;outputFormat:string;constraints:string;sampleExamples:{input:string;output:string;explanation?:string}[];timeLimitSeconds:number;maxScore:number};
type Catalog={team:{teamCode:string;name:string;availableCredits:number};cards:Card[];problems:Problem[]};

export default function PublishedPage(){
 const router=useRouter();const [catalog,setCatalog]=useState<Catalog|null>(null);const [loading,setLoading]=useState(true);const [error,setError]=useState("");
 const load=useCallback(async()=>{const session=await fetch(`${api}/api/auth/session`,{credentials:"include"});if(!session.ok){router.replace("/");return;}const identity=(await session.json()).user as {role:string};if(identity.role!=="TEAM"){router.replace("/admin");return;}const response=await fetch(`${api}/api/team/catalog`,{credentials:"include"});const body=await response.json().catch(()=>({}));if(response.status===409){router.replace("/dashboard");return;}if(!response.ok)throw new Error(body.error??"Could not load published items");setCatalog(body);setError("");setLoading(false);},[router]);
 useEffect(()=>{load().catch(e=>{setError(e instanceof Error?e.message:"Could not load published items");setLoading(false);});},[load]);
 useEffect(()=>{const socket:Socket=io(api,{withCredentials:true,transports:["websocket"]});socket.on("event.updated",()=>void load());socket.on("team.updated",()=>void load());return()=>{socket.disconnect();};},[load]);
 if(loading||!catalog)return <main className="workspace-loading"><div className="loading-mark">A</div><p>LOADING PUBLISHED CATALOG…</p>{error&&<p className="error-banner">{error}</p>}</main>;
 return <main className="dashboard-shell flow-page published-page"><header className="workspace-nav"><a className="brand" href="/dashboard"><span className="brand-mark">A</span> ALGORITHM <b>AUCTION</b></a><span className="flow-page-label">STEP 02 · PUBLISHED CONTENT</span><button className="text-button" onClick={()=>router.push("/dashboard")}>AUCTION FLOOR ↗</button></header><TeamFlowNav current="published" availableCredits={catalog.team.availableCredits}/>
  <section className="dashboard-heading"><div><p className="eyebrow"><span/> STEP 02 / EVENT CATALOG</p><h1>Published <em>for your event.</em></h1></div><p className="muted">Hover over a power card to reveal its details.</p></section>
  {error&&<div className="toast-message" role="alert">{error}</div>}
  <section className="published-catalog flow-catalog"><div className="catalog-groups">
   <div className="power-card-gallery-section"><h3>POWER CARDS <small>{catalog.cards.length}</small></h3>{catalog.cards.length?<div className="power-card-gallery" aria-label="Published power cards">{catalog.cards.map(card=><article className="power-card-gallery-item" key={card.id} tabIndex={0}>{card.imageUrl?<img src={`${api}${card.imageUrl}`} alt={card.name}/>:<div className="power-card-gallery-placeholder"><span>POWER CARD</span></div>}<span className="power-card-collapsed-title">{card.name}</span><div className="power-card-gallery-details"><span className="section-index">POWER CARD</span><h4>{card.name}</h4><p>{card.description}</p></div></article>)}</div>:<p className="catalog-empty">No power cards have been published yet.</p>}</div>
   <div><h3>ALGORITHMS <small>{catalog.problems.length}</small></h3>{catalog.problems.length?<div className="published-card-grid">{catalog.problems.map(problem=><article className="published-card" key={problem.id}><div className="published-card-body"><span className="section-index">{problem.problemCode}</span><h4>{problem.title}</h4><p>{problem.statement}</p><div className="problem-meta"><span>{Math.floor(problem.timeLimitSeconds/60)} MIN</span><span>{problem.maxScore} PTS</span><span>{problem.sampleExamples.length} SAMPLES</span></div>{problem.sampleExamples.length>0&&<details className="sample-details"><summary>VIEW SAMPLE CASES</summary>{problem.sampleExamples.map((sample,index)=><div key={index}><b>SAMPLE {index+1}</b><pre>Input: {sample.input}{"\n"}Output: {sample.output}</pre>{sample.explanation&&<p>{sample.explanation}</p>}</div>)}</details>}</div></article>)}</div>:<p className="catalog-empty">No algorithms have been published yet.</p>}</div>
  </div></section>
  <section className="flow-next-step"><div><span className="section-index">NEXT · STEP 03</span><h2>See the admin’s current display.</h2><p>Featured power cards and algorithms update here when the admin changes them.</p></div><button className="primary-button" onClick={()=>router.push("/display")}>OPEN EVENT DISPLAY <b>↗</b></button></section>
  <footer className="workspace-footer"><span>ALGORITHM AUCTION <i>· PUBLISHED CATALOG</i></span><span>LIVE CATALOG SYNC <b className="connected">●</b></span></footer>
 </main>;
}
