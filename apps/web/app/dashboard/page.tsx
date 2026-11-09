"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { io, Socket } from "socket.io-client";
import { getApiBase } from "../lib/api";
import { createIdempotencyKey } from "../lib/idempotency";
import TeamFlowNav from "../components/team-flow-nav";
import { teamDisplayCode, teamDisplayName } from "../lib/team-labels";

const api = getApiBase();
type TeamData = { id:string; teamCode:string; name:string; startedAt:string|null; credits:number; reservedCredits:number; availableCredits:number; users:{id:string;email:string;teamSlot:number|null;active:boolean}[] };
type AuctionItem = { id:string; currentBid:number; closesAt:string|null; highestTeamId:string|null; highestTeam?:{id:string;teamCode:string;name:string}|null; card?:{id:string;name:string;description:string;benefits:string[];conditions:string|null;startingBid:number}|null; problem?:{id:string;problemCode:string;title:string;difficulty:string;statement:string;timeLimitSeconds:number;maxScore:number;startingBid:number;maxBid:number|null}|null };
type Snapshot = { team:TeamData; event:{id:string;name:string;status:string;codingRoundOpen:boolean}|null };
type PublishedCard={id:string;name:string;description:string;imageUrl:string|null;benefits:string[];conditions:string|null;usageLimit:number|null;effectType:string;effectValue:number};
type PublishedProblem={id:string;problemCode:string;title:string;difficulty:string;statement:string;inputFormat:string;outputFormat:string;constraints:string;sampleExamples:{input:string;output:string;explanation?:string}[];timeLimitSeconds:number;maxScore:number};
type PublishedCatalog={cards:PublishedCard[];problems:PublishedProblem[]};

export default function DashboardPage(){
  const router=useRouter();
  const [snapshot,setSnapshot]=useState<Snapshot|null>(null);
  const [auctions,setAuctions]=useState<{kind:string;status:string;endsAt:string|null;items:AuctionItem[]}[]>([]);
  const [catalog,setCatalog]=useState<PublishedCatalog>({cards:[],problems:[]});
  const [connection,setConnection]=useState(false);
  const [presence,setPresence]=useState<string[]>([]);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");

  const load=useCallback(async()=>{
    const session=await fetch(`${api}/api/auth/session`,{credentials:"include"});
    if(!session.ok){router.replace("/");return;}
    const identity=(await session.json()).user as {role:string};
    if(identity.role!=="TEAM"){router.replace("/admin");return;}
    const [teamResult,auctionResult]=await Promise.all([
      fetch(`${api}/api/team`,{credentials:"include"}),
      fetch(`${api}/api/auctions`,{credentials:"include"}),
    ]);
    if(teamResult.status===401){router.replace("/");return;}
    const body=await teamResult.json();
    if(!teamResult.ok)throw new Error(body.error??"Could not load team dashboard");
    setSnapshot(body);
    if(body.team.startedAt){const catalogResult=await fetch(`${api}/api/team/catalog`,{credentials:"include"});if(catalogResult.ok)setCatalog(await catalogResult.json());}
    else setCatalog({cards:[],problems:[]});
    if(auctionResult.ok){const auctionBody=await auctionResult.json();setAuctions(auctionBody.auctions??[]);}
  },[router]);

  useEffect(()=>{load().catch(e=>setMessage(e.message));},[load]);
  useEffect(()=>{
    const socket:Socket=io(api,{withCredentials:true,transports:["websocket"]});
    socket.on("connect",()=>setConnection(true));
    socket.on("disconnect",()=>setConnection(false));
    socket.on("team.presence",(data:{connectedMembers:string[]})=>setPresence(data.connectedMembers));
    socket.on("team.updated",()=>void load());
    socket.on("auction.updated",()=>void load());
    socket.on("event.updated",()=>void load());
    return()=>{socket.disconnect();};
  },[load]);

  async function action(path:string,body?:unknown){
    setBusy(true);setMessage("");
    try{
      const response=await fetch(`${api}${path}`,{method:"POST",credentials:"include",headers:{...(body?{"Content-Type":"application/json"}:{})},...(body?{body:JSON.stringify(body)}:{})});
      const data=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(data.error??"Action could not be completed");
      await load();return data;
    }catch(error){setMessage(error instanceof Error?error.message:"Action failed");return null;}
    finally{setBusy(false);}
  }

  async function bid(item:AuctionItem,amount:number){
    setBusy(true);setMessage("");
    try{
      const response=await fetch(`${api}/api/auctions/items/${item.id}/bids`,{method:"POST",credentials:"include",headers:{"Content-Type":"application/json","Idempotency-Key":createIdempotencyKey()},body:JSON.stringify({amount})});
      const data=await response.json();if(!response.ok)throw new Error(data.error??"Bid rejected");await load();setMessage("Bid placed. Your team’s available credits have updated.");
    }catch(error){setMessage(error instanceof Error?error.message:"Bid failed");}
    finally{setBusy(false);}
  }

  async function startCoding(){
    const result=await action("/api/team/coding-round/start");
    if(result)router.push("/problems");
  }
  async function logout(){await fetch(`${api}/api/auth/logout`,{method:"POST",credentials:"include"});router.replace("/");}

  if(!snapshot)return <main className="workspace-loading"><div className="loading-mark">A</div><p>CONNECTING TO YOUR TEAM…</p>{message&&<p className="error-banner">{message}</p>}</main>;
  const {team,event}=snapshot;
  const connected=team.users.filter(user=>presence.includes(user.id)).length;
  const canStartTeamSession=event?.status==="READY"||event?.status==="LIVE";
  if(!team.startedAt)return <main className="start-screen"><header className="workspace-nav"><a className="brand" href="/dashboard"><span className="brand-mark">A</span> ALGORITHM <b>AUCTION</b></a><div className="start-nav-actions"><button onClick={()=>router.push("/leaderboard")} className="text-button">LEADERBOARD ↗</button><button onClick={logout} className="text-button">SIGN OUT ↗</button></div></header><section className="start-card"><div className="eyebrow"><span/> {canStartTeamSession?`EVENT ${event?.status}`:"WAITING FOR ADMIN"}</div><div className="start-orb">{teamDisplayName(team.teamCode,team.name).replace("Team ","")}</div><p className="kicker">{teamDisplayName(team.teamCode,team.name)}</p><h1>Make your<br/><em>first move.</em></h1><p className="muted">{canStartTeamSession?"The administrator has set the event ready. Start your team session to enter the event floor.":"Your team space is ready. The Start button will activate when the administrator sets the event to READY."}</p><div className="member-list">{team.users.map(m=><span key={m.id}><i className={presence.includes(m.id)?"online":""}/>{m.email}<small>{presence.includes(m.id)?"ONLINE":"OFFLINE"}</small></span>)}</div><button className="primary-button" disabled={busy||!canStartTeamSession} onClick={async()=>{const result=await action("/api/team/start");if(result)router.push("/published");}}>{busy?"STARTING TEAM SESSION…":canStartTeamSession?"START TEAM SESSION":"WAITING FOR ADMIN"} <b>↗</b></button>{message&&<p className="error-banner">{message}</p>}</section></main>;

  const powerItems=auctions.filter(a=>a.kind==="POWER_CARD").flatMap(a=>a.items.map(item=>({auction:a,item})));
  const problemItems=auctions.filter(a=>a.kind==="PROBLEM").flatMap(a=>a.items.map(item=>({auction:a,item})));
  return <main className="dashboard-shell">
    <header className="workspace-nav"><a className="brand" href="/dashboard"><span className="brand-mark">A</span> ALGORITHM <b>AUCTION</b></a><div className="nav-mid"><span className="team-tag">{teamDisplayName(team.teamCode,team.name)}</span></div><div className="nav-actions"><span className="credit-chip"><i/> {team.availableCredits.toLocaleString()} <small>CREDITS</small></span><button className="nav-link" onClick={()=>router.push("/leaderboard")}>LEADERBOARD</button><button className="nav-link event-display-link" onClick={()=>router.push("/published")}>PUBLISHED</button><button className="nav-link event-display-link" onClick={()=>router.push("/display")}>EVENT DISPLAY</button><button className="nav-link event-display-link" onClick={()=>router.push("/allocations")}>MY ALLOTMENTS</button><span className={`connection-tag ${connection?"":"offline"}`}><i/>{connection?`${connected} / 2 MEMBERS`:"RECONNECTING"}</span><button onClick={logout} className="text-button">EXIT ↗</button></div></header>
    <section className="dashboard-heading"><div><p className="eyebrow"><span/> LIVE EVENT FLOOR</p><h1>Think ahead.<br/><em>Bid with intent.</em></h1></div><div className="event-status"><span className={`status-dot ${event?.status==="LIVE"?"live":""}`}/><b>{event?.status??"WAITING"}</b><small>{event?.name??"EVENT NOT CONFIGURED"}</small></div></section>
    {message&&<div className="toast-message" role="status">{message}<button onClick={()=>setMessage("")}>×</button></div>}
    <section className="auction-columns">
      <div className="auction-section power-section"><div className="section-heading"><div><span className="section-index">01 / AUCTION</span><h2>Power cards</h2></div><span className="live-label"><i/> {powerItems.some(({auction})=>auction.status==="OPEN")?"LIVE":"UP NEXT"}</span></div><div className="auction-scroll">
        {powerItems.length?powerItems.map(({auction,item})=><AuctionCard key={item.id} item={item} kind="POWER_CARD" available={team.availableCredits} endsAt={auction.endsAt} auctionStatus={auction.status} busy={busy} onBid={bid}/>):<div className="empty-auction"><div>◇</div><h3>Cards are on the way.</h3><p>The administrator will open the Power Card auction when the event is ready.</p></div>}
      </div></div>
      <div className="auction-section algorithm-section"><div className="section-heading"><div><span className="section-index">02 / AUCTION</span><h2>Algorithm problems</h2></div><span className="live-label"><i/> {problemItems.some(({auction})=>auction.status==="OPEN")?"LIVE":"UP NEXT"}</span></div><div className="auction-scroll problem-scroll">
        {problemItems.length?problemItems.map(({auction,item})=><AuctionCard key={item.id} item={item} kind="PROBLEM" available={team.availableCredits} endsAt={auction.endsAt} auctionStatus={auction.status} busy={busy} onBid={bid}/>):<div className="empty-auction"><div>⌘</div><h3>Problems await.</h3><p>Published algorithms appear here when their auction begins.</p></div>}
      </div></div>
    </section>
    <section className="published-catalog" aria-labelledby="published-catalog-heading">
      <div className="section-heading catalog-heading"><div><span className="section-index">EVENT LIBRARY</span><h2 id="published-catalog-heading">Published cards and algorithms</h2></div><span className="live-label">{catalog.cards.length+catalog.problems.length} AVAILABLE</span></div>
      <div className="catalog-groups">
        <div><h3>POWER CARDS <small>{catalog.cards.length}</small></h3>{catalog.cards.length?<div className="published-card-grid">{catalog.cards.map(card=><article className="published-card" key={card.id}>{card.imageUrl&&<img className="catalog-image" src={`${api}${card.imageUrl}`} alt={card.name}/>}<div className="published-card-body"><span className="section-index">POWER CARD</span><h4>{card.name}</h4><p>{card.description}</p>{card.benefits.length>0&&<ul className="benefits">{card.benefits.map((benefit,index)=><li key={index}>{benefit}</li>)}</ul>}{card.conditions&&<p className="catalog-condition"><b>CONDITIONS</b> {card.conditions}</p>}</div></article>)}</div>:<p className="catalog-empty">No power cards have been published yet.</p>}</div>
        <div><h3>ALGORITHMS <small>{catalog.problems.length}</small></h3>{catalog.problems.length?<div className="published-card-grid">{catalog.problems.map(problem=><article className="published-card algorithm-catalog-card" key={problem.id}><div className="published-card-body"><span className="section-index">{problem.problemCode}</span><h4>{problem.title}</h4><p>{problem.statement}</p><div className="problem-meta"><span>{Math.floor(problem.timeLimitSeconds/60)} MIN</span><span>{problem.maxScore} PTS</span><span>{problem.sampleExamples.length} SAMPLES</span></div>{problem.sampleExamples.length>0&&<details className="sample-details"><summary>VIEW SAMPLE CASES</summary>{problem.sampleExamples.map((sample,index)=><div key={index}><b>SAMPLE {index+1}</b><pre>Input: {sample.input}{"\n"}Output: {sample.output}</pre>{sample.explanation&&<p>{sample.explanation}</p>}</div>)}</details>}</div></article>)}</div>:<p className="catalog-empty">No algorithms have been published yet.</p>}</div>
      </div>
    </section>
    <section className="coding-cta"><div><span className="section-index">NEXT ROUND</span><h2>Ready to turn bids into solutions?</h2><p>{event?.codingRoundOpen?"The administrator opened the coding round. Your assigned problems are ready.":"Waiting for the administrator to start the coding round."}</p></div><button className="primary-button" disabled={busy||!event?.codingRoundOpen||event.status!=="LIVE"} onClick={()=>void startCoding()}>START CODING ROUND <b>↗</b></button></section>
    <footer className="workspace-footer"><span>ALGORITHM AUCTION <i>· {teamDisplayName(team.teamCode,team.name)}</i></span><span>REAL-TIME EVENT SYNC <b className={connection?"connected":""}>●</b></span></footer>
  </main>;
}

function AuctionCard({item,kind,available,endsAt,auctionStatus,busy,onBid}:{item:AuctionItem;kind:string;available:number;endsAt:string|null;auctionStatus:string;busy:boolean;onBid:(item:AuctionItem,amount:number)=>void}){
  const [amount,setAmount]=useState(item.highestTeamId?item.currentBid+1:item.currentBid);
  const [history,setHistory]=useState<{teamCode:string;teamName:string;amount:number;createdAt:string}[]|null>(null);
  const [showHistory,setShowHistory]=useState(false);
  useEffect(()=>setAmount(item.highestTeamId?item.currentBid+1:item.currentBid),[item.currentBid,item.highestTeamId]);
  const active=auctionStatus==="OPEN"&&Boolean(endsAt&&new Date(endsAt).getTime()>Date.now());
  const title=kind==="POWER_CARD"?item.card?.name:item.problem?.title;
  return <article className="auction-item">
    <div className="item-top"><span className="item-icon">{kind==="POWER_CARD"?"◇":"⌘"}</span><span className="item-code">{item.problem?.problemCode??"POWER CARD"}</span><span className={`item-state ${active?"active":""}`}><i/>{active?<>OPEN · <Countdown endsAt={endsAt!}/></>:auctionStatus}</span></div>
    <h3>{title}</h3><p className="item-description">{kind==="POWER_CARD"?item.card?.description:item.problem?.statement}</p>
    {kind==="POWER_CARD"&&item.card?.benefits&&<ul className="benefits">{item.card.benefits.slice(0,3).map((benefit,i)=><li key={i}>{benefit}</li>)}</ul>}
    {kind==="PROBLEM"&&<div className="problem-meta"><span>{item.problem?.timeLimitSeconds?`${Math.floor(item.problem.timeLimitSeconds/60)} MIN`:""}</span><span>{item.problem?.maxScore} PTS</span></div>}
    <div className="bid-line"><div><small>{item.highestTeam?"CURRENT LEADER":"OPENING BID"}</small><b>{item.highestTeam?teamDisplayName(item.highestTeam.teamCode,item.highestTeam.name):"—"}</b></div><strong>{item.currentBid.toLocaleString()} <small>CR</small></strong></div>
    <div className="bid-controls"><label><span>YOUR BID</span><div><input type="number" min={item.highestTeamId?item.currentBid+1:item.currentBid} max={available} step="1" value={amount} onChange={e=>setAmount(Number(e.target.value))} disabled={!active||busy}/><small>CR</small></div></label><button disabled={!active||busy||amount>available||amount<(item.highestTeamId?item.currentBid+1:item.currentBid)} onClick={()=>onBid(item,amount)}>PLACE BID <b>↗</b></button></div>
    <button className="history-toggle" onClick={async()=>{if(!showHistory&&!history){const result=await fetch(`${api}/api/auctions/items/${item.id}/history`,{credentials:"include"});const body=await result.json();if(result.ok)setHistory(body.bids??[]);}setShowHistory(!showHistory);}}>BID HISTORY {showHistory?"−":"+"}</button>
    {showHistory&&<div className="bid-history">{history?.length?history.map(bid=><div key={bid.createdAt+bid.teamCode}><span>{teamDisplayName(bid.teamCode,bid.teamName)}</span><b>{bid.amount.toLocaleString()} CR</b><time>{new Date(bid.createdAt).toLocaleTimeString()}</time></div>):<small>No bids yet.</small>}</div>}
  </article>;
}
function Countdown({endsAt}:{endsAt:string}){const [remaining,setRemaining]=useState(Math.max(0,Math.ceil((new Date(endsAt).getTime()-Date.now())/1000)));useEffect(()=>{const timer=setInterval(()=>setRemaining(Math.max(0,Math.ceil((new Date(endsAt).getTime()-Date.now())/1000))),1000);return()=>clearInterval(timer);},[endsAt]);return <>{String(Math.floor(remaining/60)).padStart(2,"0")}:{String(remaining%60).padStart(2,"0")}</>;}
