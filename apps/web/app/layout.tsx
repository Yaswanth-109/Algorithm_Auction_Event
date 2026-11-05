import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "Algorithm Auction",
  description: "Bid Smart. Play Your Cards. Crack the Code.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
