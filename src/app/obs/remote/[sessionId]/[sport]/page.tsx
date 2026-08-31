import BaseballController from "@/components/sports/BaseballController";
import BasketballController from "@/components/sports/BasketballController";
import SoccerController from "@/components/sports/SoccerController";
import VolleyballController from "@/components/sports/VolleyballController";
import { isSportKey } from "@/components/sports/sportSettings";
import { notFound } from "next/navigation";

export default async function RemoteSportControllerPage({ params }: { params: Promise<{ sport: string }> }) {
  const { sport } = await params;
  if (!isSportKey(sport)) notFound();
  if (sport === "soccer") return <SoccerController />;
  if (sport === "basketball") return <BasketballController />;
  if (sport === "baseball") return <BaseballController />;
  return <VolleyballController />;
}
