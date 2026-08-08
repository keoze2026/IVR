/** This campaign's calls, scoped by the `campaign` filter the API supports. */

import { useOutletContext } from "react-router-dom";

import { CallsTable } from "@/features/calls/CallsTable";
import type { Campaign } from "@/types/domain";

export function CampaignCallsPage() {
  const campaign = useOutletContext<Campaign>();
  return <CallsTable campaignId={campaign.id} />;
}
