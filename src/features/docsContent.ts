import { CONTRACTS, DEGEN_REWARDS_HELPER, NFT_TOKEN_ID } from "../config/contracts";
import { GOVERNANCE_ACTIONS_DISABLED } from "../config/publicPreview";
import { FARM_REGISTRY, MINER_POOLS, TREASURY } from "./dashboard/config";
import { GOVERNANCE_ADDRESSES } from "./governance/governanceSpec";

export const DOC_SECTIONS = [
  { id: "guides", label: "Guides & sources" },
  { id: "faq", label: "FAQ" },
  { id: "contracts", label: "Contracts" },
  { id: "sources", label: "Contract sources" },
  { id: "treasury", label: "Treasury & activity" },
  { id: "tools", label: "More DEGEN tools" },
] as const;
export type DocSection = typeof DOC_SECTIONS[number]["id"];

export type DocFaq = { id: string; group: string; question: string; answer: string; keywords?: string; href?: string; linkLabel?: string };
export const DOC_FAQS: readonly DocFaq[] = [
  { id: "miner-farm", group: "Miners, farms & rewards", question: "What is the difference between a miner and a farm?", answer: "A time miner holds DEGEN in a duration-based pool and records your position as shares. A farm holds the asset accepted by that farm, such as an LP token, and earns DEGEN rewards.", href: "/how-it-works", linkLabel: "See the routes through DEGEN" },
  { id: "durations", group: "Miners, farms & rewards", question: "Which miner durations are listed?", answer: "The four DEGEN time-miner pools are 1 month, 3 months, 1 year and 10 years. Deploy Miners lets you choose a duration and create a position for yourself or another wallet.", keywords: "lock term length gift deposit", href: "/my-miners?tab=deploy", linkLabel: "Explore miner durations" },
  { id: "shares", group: "Miners, farms & rewards", question: "How is my miner balance calculated?", answer: "Your miner shares are multiplied by the pool’s current price per full share. The displayed DEGEN value changes as the pool balance and share price change. Growth already included in that value is part of the miner balance.", keywords: "gross value funding shares PPFS" },
  { id: "maturity", group: "Miners, farms & rewards", question: "What happens when a miner reaches 100% progress?", answer: "Progress compares elapsed time with the pool’s lock duration. The maturity and grace window, withdrawal terms and any mandatory service determine the available actions. My Miners groups positions by their current timing status and offers the actions supported for the selected position.", keywords: "mature grace overdue early late fee penalty lock", href: "/my-miners", linkLabel: "View your miners" },
  { id: "farm-stake", group: "Miners, farms & rewards", question: "How do I stake in a farm?", answer: "Choose the farm for the asset you hold, enter an amount and approve that amount when an allowance is needed. Create a new stake to deposit it. The farm card separates the amount in your wallet, the deposited amount and pending rewards.", keywords: "deposit LP allowance approve stake", href: "/farms", linkLabel: "Explore farms" },
  { id: "claim-all", group: "Miners, farms & rewards", question: "What does Claim All Rewards include?", answer: "Claim All Rewards collects eligible rewards across the supported farm stakes in your wallet, including DEGEN already collected in the rewards helper. The combined amount is counted once and uses the same current claim quote as the claim form.", keywords: "harvest helper total claimable reward balances", href: "/farms", linkLabel: "Open farm rewards" },
  { id: "claim-estimates", group: "Miners, farms & rewards", question: "Why can a farm’s rewards differ from the combined claim amount?", answer: "Individual farm reward getters are estimates. The combined claim quote simulates the harvest across your stakes and includes the resulting helper balance. Funding and accrued reward credit can make that amount differ from adding the individual getter estimates.", keywords: "funding earnings total helper APR" },
  { id: "claim-destination", group: "Miners, farms & rewards", question: "Where do claimed rewards go?", answer: "The claim form lists the available destinations and their payout amounts. A miner destination creates or funds a position in that pool; a wallet destination pays tokens to the wallet. NFT rewards have separate destination choices for OINK and DEGEN.", keywords: "harvest payout pool default penalty" },
  { id: "apr", group: "Miners, farms & rewards", question: "What does the APR estimate mean?", answer: "APR annualizes the current reward allocation relative to the assets staked and their current prices. The calculator applies those current inputs to the selected time period. Changes in allocation, prices or pool balances change the estimate.", keywords: "annual return growth projection rewards calculator" },
  { id: "max", group: "Miners, farms & rewards", question: "What does MAX do?", answer: "MAX fills the amount field with the balance available to that action. It fills the form only. Approval, staking, claiming and withdrawal each have their own transaction button.", keywords: "maximum amount wallet balance" },
  { id: "farm-withdraw", group: "Miners, farms & rewards", question: "How do I withdraw a farm stake?", answer: "Open Manage stakes on its farm card, select the recorded stake and use its withdrawal action. Farm stakes are withdrawn by position; the displayed deposit and rewards belong to that specific stake.", keywords: "unstake exit manage position", href: "/farms", linkLabel: "Manage farm stakes" },
  { id: "mint", group: "NFTs & portfolio", question: "What do I receive when I mint an NFT?", answer: `The DEGEN NFT is an ERC-1155 token on PulseChain. Minting pays PLS to the NFT purchases contract, which mints the chosen quantity of token ID ${NFT_TOKEN_ID.toString()} to the paying wallet. The NFT page reads that wallet’s balance from the NFT contract.`, keywords: "buy purchase receive quantity mint price PLS", href: "/nft", linkLabel: "Open NFT minting" },
  { id: "nft-import", group: "NFTs & portfolio", question: "Why is the NFT balance on the site different from my wallet’s NFT gallery?", answer: `The site reads the ERC-1155 balance directly. A wallet’s gallery also depends on its NFT indexing and metadata support. For a manual import, use PulseChain, the DEGEN NFT contract and token ID ${NFT_TOKEN_ID.toString()}; the contract address is in the directory below.`, keywords: "import show image gallery collection metamask token id wallet", href: "/protocol?section=contracts", linkLabel: "View NFT contract details" },
  { id: "nft-rewards", group: "NFTs & portfolio", question: "Which rewards do DEGEN NFT miners earn?", answer: "The NFT miner tracks OINK and DEGEN rewards separately. Its Rewards tab shows each pending balance and provides automatic-harvest settings, manual harvesting and the NFT burn form.", keywords: "OINK DEGEN dual rewards harvest burn settings", href: "/nft", linkLabel: "View NFT rewards" },
  { id: "portfolio", group: "NFTs & portfolio", question: "What is included in portfolio value?", answer: "Portfolio value adds wallet DEGEN, the current DEGEN value of time miners and the supported farm deposits. Pending farm rewards and NFT reward balances are displayed separately. NFT resale values, HEX stakes and other wallet tokens are outside that total.", keywords: "USD total dollars prices balance holdings estimate", href: "/portfolio", linkLabel: "View your portfolio" },
  { id: "live-values", group: "NFTs & portfolio", question: "Are the balances live or estimated?", answer: "Token amounts, miner shares, farm positions and reward balances come from PulseChain reads for the connected wallet. USD amounts use current market prices. An LP deposit is valued using its share of the pair’s underlying reserves.", keywords: "RPC data price refresh real wallet balances" },
  { id: "governance-credit", group: "Governance & tools", question: "What is DEGEN voting credit?", answer: "Voting credit is the balance used by governance proposals and votes. It is separate from wallet DEGEN and miner principal. Governance modules show their current proposal cost, review period and existing proposals.", keywords: "council votes DAO commitment sacrifice", href: "/governance", linkLabel: "Explore governance" },
  { id: "governance-status", group: "Governance & tools", question: "Can I submit governance transactions here?", answer: GOVERNANCE_ACTIONS_DISABLED ? "Governance transactions are temporarily disabled while this section is updated and tested. Current parameters, proposal records, form fields and read-only proposal checks remain available. Farm, miner and NFT actions remain available." : "The governance page provides proposal creation, voting, veto and enforcement for its supported modules. Available actions depend on the current proposal state and the connected wallet.", keywords: "disabled paused testing enabled create vote enforce maintenance" },
  { id: "sale-referral", group: "Governance & tools", question: "Where are the sale and referral pages?", answer: "Open the Degen dropdown in the navbar. Sale opens the miner sale tab, and Referral opens your referral rewards and claim destination controls. Both are also available from the miner workspace.", keywords: "sale buy referral rewards navigation tabs", href: "/my-miners?tab=sale", linkLabel: "Open the miner sale" },
];

export type DocResource = { title: string; description: string; href: string; external?: boolean; keywords?: string };
export const DOC_GUIDES: readonly DocResource[] = [
  { title: "How it works", description: "Follow DEGEN through time miners, asset farms and NFT miners.", href: "/how-it-works", keywords: "start introduction overview timeline" },
  { title: "Miners, farms & rewards", description: "Answers about shares, durations, claiming, balances and NFT units.", href: "/protocol?section=faq", keywords: "questions APR fees lock maturity" },
  { title: "Contract directory", description: "The PulseChain addresses used by this interface, grouped by role.", href: "/protocol?section=contracts", keywords: "addresses blockchain explorer tokens" },
  { title: "DEGEN interface source", description: "The original public interface repository and project assets.", href: "https://github.com/degenstrategy/interface", external: true, keywords: "github original repository code" },
];

export const DOC_SOURCES: readonly DocResource[] = [
  { title: "DEGEN token", description: "Token contract, transactions and published explorer records.", href: `https://scan.pulsechain.com/address/${CONTRACTS.degen}`, external: true },
  { title: "NFT miner", description: "ERC-1155 NFT balances and the NFT miner’s contract records.", href: `https://scan.pulsechain.com/address/${CONTRACTS.nft}`, external: true },
  { title: "NFT purchases", description: "The contract used for NFT mint purchases and purchase records.", href: `https://scan.pulsechain.com/address/${CONTRACTS.mint}`, external: true },
  { title: "Governance", description: "Governor contract, public transactions and linked contract records.", href: `https://scan.pulsechain.com/address/${GOVERNANCE_ADDRESSES.governor}`, external: true },
  { title: "Original interface", description: "Public DEGEN interface source and its original pages.", href: "https://github.com/degenstrategy/interface", external: true },
];

export const DOC_TOOLS: readonly DocResource[] = [
  { title: "My miners", description: "Track positions, maturity windows and miner actions.", href: "/my-miners", keywords: "withdraw rollover transfer" },
  { title: "Deploy miners", description: "Create a DEGEN time miner for yourself or another wallet.", href: "/my-miners?tab=deploy", keywords: "deposit gift stake duration" },
  { title: "Farms", description: `Browse the ${FARM_REGISTRY.length} listed farms, deposit assets and claim rewards.`, href: "/farms", keywords: "LP stake harvest" },
  { title: "NFT miners", description: "Mint NFT units, view balances and manage OINK and DEGEN rewards.", href: "/nft", keywords: "purchase burn harvest" },
  { title: "Miner sale", description: "View sale balances and available miner purchase options.", href: "/my-miners?tab=sale", keywords: "buy PLS PLSX INC" },
  { title: "Referral", description: "View referral rewards and choose a claim destination.", href: "/my-miners?tab=referral", keywords: "bonus earnings redeem" },
  { title: "Portfolio", description: "See your wallet DEGEN, time miners, farm deposits and pending rewards.", href: "/portfolio", keywords: "USD balance totals" },
  { title: "Governance", description: "Read protocol parameters and explore the proposal workspace.", href: "/governance", keywords: "DAO council voting credit" },
];

export type DocContract = { label: string; address: string; detail?: string };
export type DocContractGroup = { id: string; label: string; contracts: readonly DocContract[] };
export const DOC_CONTRACT_GROUPS: readonly DocContractGroup[] = [
  { id: "core", label: "Core tokens & NFTs", contracts: [
    { label: "DEGEN token", address: CONTRACTS.degen },
    { label: "OINK reward token", address: CONTRACTS.oink },
    { label: "NFT miner", address: CONTRACTS.nft, detail: `ERC-1155 · Token ID ${NFT_TOKEN_ID.toString()}` },
    { label: "NFT purchases", address: CONTRACTS.mint },
  ] },
  { id: "miners", label: "Time miners", contracts: [...MINER_POOLS].reverse().map(pool => ({ label: `${pool.label} DEGEN miner`, address: pool.address })) },
  { id: "farms", label: "Asset farms", contracts: FARM_REGISTRY.map(farm => ({ label: farm.name, address: farm.address })) },
  { id: "governance", label: "Governance", contracts: [
    { label: "Governor", address: GOVERNANCE_ADDRESSES.governor },
    { label: "Farm governance", address: GOVERNANCE_ADDRESSES.farms },
    { label: "Basic governance", address: GOVERNANCE_ADDRESSES.basic },
    { label: "Treasury governance", address: GOVERNANCE_ADDRESSES.treasury },
    { label: "Voting credit", address: GOVERNANCE_ADDRESSES.credit },
    { label: "MasterChef", address: GOVERNANCE_ADDRESSES.masterChef },
  ] },
  { id: "helpers", label: "Treasury, sale & helpers", contracts: [
    { label: "Treasury wallet", address: TREASURY },
    { label: "Farm rewards helper", address: DEGEN_REWARDS_HELPER },
    { label: "Miner sale", address: CONTRACTS.sale },
    { label: "Referrals", address: CONTRACTS.referral },
    { label: "Referral rewards", address: CONTRACTS.referralRewards },
  ] },
];

export function docsMatch(query: string, ...values: (string | undefined)[]): boolean {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const text = values.filter(Boolean).join(" ").toLowerCase();
  return terms.every(term => text.includes(term));
}
