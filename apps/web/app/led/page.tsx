"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { getApiBase } from "../lib/api";
import { teamDisplayCode, teamDisplayName } from "../lib/team-labels";

const api = getApiBase();
type Card = { id:string;name:string;description:string;benefits:string[];conditions:string|null;effectType:string;effectValue:number;imageUrl:string|null };
type Problem = { id:string;problemCode:string;title:string;statement:string;inputFormat:string;outputFormat:string;constraints:string;sampleExamples:{input:string;output:string}[];timeLimitSeconds:number;maxScore:number };
type Row = { rank:number;teamCode:string;teamName:string;solvedProblems:number;solutionScore:number;timingScore:number;creditBonus:number;totalScore:number };
type Catalog = { cards:Card[];problems:Problem[] };
type Current = { card:Card|null;problem:Problem|null };
const views=[{id:"published",label:"01 · PUBLISHED"},{id:"current",label:"02 · ON DISPLAY"},{id:"leaderboard",label:"03 · LEADERBOARD"}];

export default function LedDisplayPage(){return <Suspense fallback={<main className="led-shell"><p>LOADING EVENT SCREEN…</p></main>}><LedDisplayContent/></Suspense>;}

function LedDisplayContent(){
 const params=useSearchParams();const view=views.some(item=>item.id===params.get("page"))?params.get("page")!:"published";
 const [catalog,setCatalog]=useState<Catalog|null>(null);const [current,setCurrent]=useState<Current|null>(null);const [rows,setRows]=useState<Row[]>([]);const [error,setError]=useState("");
 const load=useCallback(async()=>{
  const endpoint=view==="current"?"current":view==="leaderboard"?"leaderboard":"catalog";
  try{const response=await fetch(`${api}/api/public-display/${endpoint}`,{cache:"no-store"});const body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(body.error??"Could not load display");
   if(view==="current")setCurrent(body as Current);else if(view==="leaderboard")setRows((body.rows??[]) as Row[]);else setCatalog(body as Catalog);setError("");
  }catch(e){setError(e instanceof Error?e.message:"Could not load display");}
 },[view]);
 useEffect(()=>{void load();const timer=window.setInterval(()=>void load(),5000);return()=>window.clearInterval(timer);},[load]);
 return <main className="led-shell">
  <header className="led-header"><a className="brand" href="/"><span className="brand-mark">A</span> ALGORITHM <b>AUCTION</b></a><span className="led-status"><i/> LIVE EVENT DISPLAY</span><a className="led-exit" href="/">SIGN IN ↗</a></header>
  <nav className="led-nav" aria-label="LED display pages">{views.map(item=><a key={item.id} className={view===item.id?"active":""} href={`/led?page=${item.id}`}>{item.label}</a>)}</nav>
  {error&&<div className="led-message">{error}</div>}
  {view==="published"&&<>
   <section className="led-title"><span className="section-index">EVENT CATALOG</span><h1>Published <em>for today.</em></h1><p>Power cards and algorithms released by the event administrator.</p></section>
   <section className="led-catalog"><div><h2>POWER CARDS <small>{catalog?.cards.length??"—"}</small></h2><div className="led-card-grid">{catalog?.cards.map(card=><article className="led-card" key={card.id}>{card.imageUrl&&<img src={`${api}${card.imageUrl}`} alt=""/>}<span>POWER CARD</span><h3>{card.name}</h3><p>{card.description}</p>{card.benefits.map((benefit,i)=><p className="led-benefit" key={i}>◆ {benefit}</p>)}</article>)}{catalog&&!catalog.cards.length&&<p className="led-empty">No power cards published yet.</p>}</div></div>
    <div><h2>ALGORITHMS <small>{catalog?.problems.length??"—"}</small></h2><div className="led-card-grid">{catalog?.problems.map(problem=><article className="led-card" key={problem.id}><span>{problem.problemCode}</span><h3>{problem.title}</h3><p>{problem.statement}</p><b className="led-meta">{Math.floor(problem.timeLimitSeconds/60)} MINUTES <i/> {problem.maxScore} POINTS</b></article>)}{catalog&&!catalog.problems.length&&<p className="led-empty">No algorithms published yet.</p>}</div></div></section>
  </>}
  {view==="current"&&<section className="led-spotlight">{current?.card?<article className="led-focus">{current.card.imageUrl&&<img src={`${api}${current.card.imageUrl}`} alt=""/>}<span>NOW DISPLAYING · POWER CARD</span><h1>{current.card.name}</h1><p>{current.card.description}</p>{current.card.benefits.map((benefit,i)=><p className="led-benefit" key={i}>◆ {benefit}</p>)}</article>:current?.problem?<article className="led-focus"><span>NOW DISPLAYING · ALGORITHM · {current.problem.problemCode}</span><h1>{current.problem.title}</h1><p className="led-statement">{current.problem.statement}</p><div className="led-samples"><div><b>INPUT</b><pre>{current.problem.inputFormat}</pre></div><div><b>OUTPUT</b><pre>{current.problem.outputFormat}</pre></div><div><b>CONSTRAINTS</b><pre>{current.problem.constraints}</pre></div></div></article>:<div className="led-waiting"><span>EVENT SPOTLIGHT</span><h1>Waiting for the next display.</h1><p>The administrator has not selected a power card or algorithm.</p></div>}</section>}
  {view==="leaderboard"&&<><section className="led-title led-board-title"><div><span className="section-index">LIVE STANDINGS</span><h1>The <em>scoreboard.</em></h1><p>Ranks update automatically as teams solve, submit, and finish auctions.</p></div></section>{!error&&<><section className="led-podium">{rows.slice(0,3).map((row,index)=><article className={`led-podium-card place-${index+1}`} key={teamDisplayCode(row.teamCode,row.teamName)}><span>0{index+1} / RANK</span><b>{teamDisplayName(row.teamCode,row.teamName)}</b><strong>{row.totalScore.toLocaleString()} <i>PTS</i></strong></article>)}</section><div className="led-table-wrap"><table className="led-table"><thead><tr><th>RANK</th><th>TEAM</th><th>ALGORITHMS</th><th>SOLUTION</th><th>TIMING</th><th>CREDIT BONUS</th><th>TOTAL</th></tr></thead><tbody>{rows.map(row=><tr key={teamDisplayCode(row.teamCode,row.teamName)}><td>{String(row.rank).padStart(2,"0")}</td><td><b>{teamDisplayName(row.teamCode,row.teamName)}</b></td><td>{row.solvedProblems} SOLVED</td><td>{row.solutionScore.toLocaleString()}</td><td>{row.timingScore.toLocaleString()}</td><td>{row.creditBonus.toLocaleString()}</td><td className="led-score">{row.totalScore.toLocaleString()}</td></tr>)}</tbody></table>{!rows.length&&<p className="led-empty">No team scores to display yet.</p>}</div></>}</>}
  <footer className="led-footer"><span>ALGORITHM AUCTION · EVENT SCREEN</span><span>UPDATES EVERY 5 SECONDS <b>●</b></span></footer>
 </main>;
}
