"use client";

import Link from "next/link";

type TeamFlowStep = "published" | "display" | "allocations";

export default function TeamFlowNav({ current, availableCredits }: { current: TeamFlowStep; availableCredits: number }) {
  const steps: { id: TeamFlowStep; label: string; href: string }[] = [
    { id: "published", label: "PUBLISHED", href: "/published" },
    { id: "display", label: "EVENT DISPLAY", href: "/display" },
    { id: "allocations", label: "MY ALLOTMENTS", href: "/allocations" },
  ];
  return <nav className="team-flow-nav" aria-label="Event pages">
    <div className="flow-primary-links"><Link className="flow-floor-link" href="/dashboard">AUCTION FLOOR</Link><Link className="flow-leaderboard-link" href="/leaderboard">LEADERBOARD ↗</Link></div>
    <div className="flow-page-tabs"><span className="credit-chip flow-credit-chip"><i/>{availableCredits.toLocaleString()} <small>AVAILABLE CREDITS</small></span>{steps.map((step, index) => <Link key={step.id} href={step.href} aria-current={current === step.id ? "page" : undefined} className={current === step.id ? "active" : ""}><small>0{index + 1}</small>{step.label}</Link>)}</div>
  </nav>;
}
