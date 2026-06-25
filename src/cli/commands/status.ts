import { getActiveAgents } from "../../engine/activation";
import { getRecordCount, getAllVendors } from "../../db/queries";

export async function getStatus(dataSources: string[]) {
  const agents = getActiveAgents(dataSources);
  const recordCount = getRecordCount();
  const vendors = getAllVendors();

  return {
    dataSources,
    recordCount,
    vendorCount: vendors.length,
    agents,
  };
}
