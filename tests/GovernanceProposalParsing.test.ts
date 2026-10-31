import { describe, expect, it } from "vitest";
import { parseProposalTables } from "../src/features/GovernancePage";

describe("governance proposal discovery", () => {
  it("deduplicates repeated API rows by proposal ID", () => {
    const html = `
      <table id="poolAllocation-table-active">
        <thead><tr><th>For Pool</th><th>Action</th><th>Validates in</th></tr></thead>
        <tbody>
          <tr><td>DAI-9INCH</td><td><button onclick="enforcePoolAllocation(23)">Enforce</button></td><td>expired</td></tr>
          <tr><td>DAI-9INCH</td><td><button onclick="enforcePoolAllocation(23)">Enforce</button></td><td>expired</td></tr>
          <tr><td>vPLS-PLS</td><td><button onclick="enforcePoolAllocation(44)">Enforce</button></td><td>expired</td></tr>
        </tbody>
      </table>
      <table id="poolAllocation-table-expired"><tbody></tbody></table>
    `;

    const tables = parseProposalTables(html);

    expect(tables.active.rows).toHaveLength(2);
    expect(tables.active.rows.map((row) => row.proposalId)).toEqual(["23", "44"]);
  });

  it("does not discard discovery rows when the API exposes no proposal ID", () => {
    const html = `
      <table id="delay-table-active">
        <tbody>
          <tr><td>Unidentified record</td></tr>
          <tr><td>Unidentified record</td></tr>
        </tbody>
      </table>
    `;

    expect(parseProposalTables(html).active.rows).toHaveLength(2);
  });
});
