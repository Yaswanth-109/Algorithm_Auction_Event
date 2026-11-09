"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { io } from "socket.io-client";
import { getApiBase } from "../lib/api";
import { teamDisplayCode, teamDisplayName } from "../lib/team-labels";

const api=getApiBase();
type Row={rank:number;teamId:string;teamCode:string;teamName:string;solvedProblems:number;solutionScore:number;timingScore:number;creditBonus:number;adjustments:number;totalScore:number;currentTeam:boolean};
export default function LeaderboardPage(){
 const router=useRouter();const [rows,setRows]=useState<Row[]>([]);const [search,setSearch]=useState("");const [query,setQuery]=useState("");const [visibility,setVisibility]=useState("HIDDEN");const [error,setError]=useState("");const [busy,setBusy]=useState(true);
 const load=useCallback(async()=>{const auth=await fetch(`${api}/api/auth/session`,{credentials:"include"});if(!auth.ok){router.replace("/");return;}const result=await fetch(`${api}/api/leaderboard?search=${encodeURIComponent(query)}&take=100`,{credentials:"include"});const data=await result.json();if(!result.ok){setError(data.error??"Leaderboard unavailable");setBusy(false);return;}setRows(data.rows);setVisibility(data.visibility);setError("");setBusy(false);},[query,router]);
 useEffect(()=>{load().catch(e=>{setError(e.message);setBusy(false);});},[load]);
 useEffect(()=>{const socket=io(api,{withCredentials:true,transports:["websocket"]});socket.on("leaderboard.updated",()=>void load());return()=>{socket.disconnect();};},[load]);
 function submit(e:FormEvent){e.preventDefault();setBusy(true);setQuery(search);}
 return <main className="leaderboard-shell"><header className="workspace-nav"><a className="brand" href="/dashboard"><span className="brand-mark">A</span> ALGORITHM <b>AUCTION</b></a><span className="leaderboard-live"><i/> LIVE SCOREBOARD · {visibility}</span><button className="text-button" onClick={()=>router.back()}>BACK ↗</button></header><section className="leaderboard-heading"><div><p className="eyebrow"><span/> CURRENT STANDINGS</p><h1>The scoreboard.</h1><p className="muted">Ranks update automatically as teams solve, submit, and finish auctions.</p></div><form onSubmit={submit} className="leaderboard-search"><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search teams or IDs"/><button>SEARCH ↗</button></form></section>{error&&<div className="admin-empty">{error}</div>}
 <section className="podium">{rows.slice(0,3).map((row,index)=><article className={`podium-card place-${index+1}`} key={row.teamId}><span>0{index+1} / RANK</span><b>{teamDisplayName(row.teamCode,row.teamName)}</b><strong>{row.totalScore.toLocaleString()}<i>PTS</i></strong></article>)}</section>
 <div className="leaderboard-table-wrap"><table className="leaderboard-table"><thead><tr><th>RANK</th><th>TEAM</th><th>ALGORITHMS</th><th>SOLUTION</th><th>TIMING</th><th>CREDIT BONUS</th><th>TOTAL</th></tr></thead><tbody>{rows.map(row=><tr key={row.teamId} className={row.currentTeam?"current-team":""}><td>{String(row.rank).padStart(2,"0")}</td><td><b>{teamDisplayName(row.teamCode,row.teamName)}</b></td><td>{row.solvedProblems} SOLVED</td><td>{row.solutionScore}</td><td>{row.timingScore}</td><td>{row.creditBonus}</td><td><b className="total-score">{row.totalScore}</b></td></tr>)}</tbody></table>{busy&&<div className="leaderboard-loading">UPDATING STANDINGS…</div>}{!rows.length&&!error&&!busy&&<div className="admin-empty">No teams match this search.</div>}</div><footer className="workspace-footer"><span>ALGORITHM AUCTION <i>· TIE BREAK: SOLUTION, SOLVES, TIMING</i></span><span>LIVE EVENT SYNC <b className="connected">●</b></span></footer></main>;
}
