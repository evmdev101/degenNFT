export const CHAIN_ID = 369n;
export const CHAIN_HEX = "0x171";
export const NFT_TOKEN_ID = 1n;

export const CONTRACTS = {
  nft: "0x7B2DcC0D0180D6863e4D6Fa14903459638c5b45B",
  mint: "0x141a8649e3CAEb3a1589ba4922cDb651b6706281",
  rewards: "0xe2de5f20cB9271001f2B96d83801abBdE07A8f73",
  referral: "0x456d747622d30C4db69D40973ecf0D29EE007B57",
  referralRewards: "0xAAcA9cFc6Fe88Dc16e87ff8315C554220Bf13264",
  sale: "0x780B2b215447ccf34CCBB22fDE2bD591e7195b48",
  degen: "0x3e79130ab714e97ee73f86a56a2427bb1a519896",
  oink: "0xfaac6a85c3e123ab2cf7669b1024f146cfef0b38",
} as const;

export const REFERRAL_ABI = [
  "function totalUserRewards(address) view returns (uint256)",
  "function amountRedeemed(address) view returns (uint256)",
  "function redeemRewards(uint256 amount, address pool) external",
] as const;

export const REFERRAL_GOVERNANCE_ABI = [
  "function referralBonus() view returns (uint256)",
  "function rewardContract() view returns (address)",
] as const;

export const SALE_ABI = [
  "function buyWithPLS(uint256 amount, address poolInto) payable",
  "function buyWithPLSX(uint256 amount, address poolInto)",
  "function buyWithINC(uint256 amount, address poolInto)",
  "function claimTokens(uint256 amount, address poolInto)",
  "function getWithPLS(uint256 amount, address poolInto) view returns (uint256)",
  "function getWithPLSX(uint256 amount, address poolInto) view returns (uint256)",
  "function getWithINC(uint256 amount, address poolInto) view returns (uint256)",
  "function userTokens(address) view returns (uint256)",
  "function bonusAmount(address) view returns (uint256)",
  "function PLSX() view returns (address)",
  "function INC() view returns (address)",
  "function DTX() view returns (address)",
] as const;

export const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
] as const;

export const POOL_DEPOSIT_ABI = [
  "function deposit(uint256 amount) external",
  "function giftDeposit(uint256 amount, address recipient, uint256 minimumServeSeconds) external",
] as const;

export const MINER_POOL_ABI = [
  "function getNrOfStakes(address user) view returns (uint256)",
  "function userInfo(address user, uint256 stakeId) view returns (uint256 shares, uint256 lastMineredTime, uint256 xvmcAtLastUserAction, uint256 lastUserActionTime, uint256 mandatoryTimeToServe)",
  "function getPricePerFullShare() view returns (uint256)",
  "function gracePeriod() view returns (uint256)",
  "function hopStakeToAnotherPool(uint256 shares, uint256 stakeId, address poolAddress) external",
  "function transferStakeToAnotherWallet(uint256 shares, uint256 stakeId, address recipient) external",
  "function withdraw(uint256 shares, uint256 stakeId) external",
  "function withdrawAll(uint256 stakeId) external",
] as const;

export const FARM_VAULT_ABI = [
  "function getNrOfStakes(address user) view returns (uint256)",
  "function userInfo(address user, uint256 stakeId) view returns (uint256 amount, uint256 debt, uint256 feesPaid, address referredBy, uint256 lastAction)",
  "function viewUserTotalEarnings(address user) view returns (uint256)",
  "function viewStakeEarnings(address user, uint256 stakeId) view returns (uint256)",
  "function deposit(uint256 amount, address referral) payable",
  "function selfHarvest(uint256[] stakeIds, address harvestInto)",
  "function withdraw(uint256 stakeId, address harvestInto)",
] as const;

export const DEGEN_FARM_VAULT_ABI = [
  "function getNrOfStakes(address user) view returns (uint256)",
  "function userInfo(address user, uint256 stakeId) view returns (uint256 amount, uint256 debt, uint256 feesPaid, uint256 lastAction)",
  "function viewUserTotalEarnings(address user) view returns (uint256)",
  "function viewStakeEarnings(address user, uint256 stakeId) view returns (uint256)",
  "function deposit(uint256 amount, address referral) payable",
  "function withdraw(uint256 stakeId)",
] as const;

export const DEGEN_REWARDS_HELPER =
  "0xe1cAF2F0da06A97A7f04B9Ea1B43C91F447cf343";
export const DEGEN_REWARDS_ABI = [
  "function claimWithHarvest(address[] contracts, address user, uint256[][] stakeIds, uint256 amount, address into)",
  "function claimRewards(uint256 amount, address harvestInto)",
  "function balanceOf(address) view returns (uint256)",
] as const;

export const NFT_REWARDS_ABI = [
  "function getEarnings(address user) view returns (uint256 oinkRate, uint256, uint256 degenRate, uint256)",
] as const;

export const HEX_STAKE_ABI = [
  "function userInfo(address user) view returns (uint256 amount, uint256 debt, uint256 lastAction)",
  "function viewUserTotalEarnings(address user) view returns (uint256)",
  "function harvest()",
] as const;

export const NFT_ABI = [
  "function balanceOf(address account, uint256 id) view returns (uint256)",
  "function uri(uint256 id) view returns (string)",
  "function viewUserTotalEarnings(address) view returns (uint256 pendingToken1, uint256 pendingToken2)",
  "function totalNFTs() view returns (uint256)",
  "function selfHarvest(uint256 amount, address harvestInto, bool token1) external",
  "function userSettings(address) view returns (address defaultHarvest1, address defaultHarvest2, uint256 minimumHarvest1, uint256 minimumHarvest2, uint256 fee)",
  "function setUserSettings(address defaultHarvest1, address defaultHarvest2, uint256 minimumHarvest1, uint256 minimumHarvest2, uint256 fee) external",
  "function defaultMinHarvestOink() view returns (uint256)",
  "function defaultMinHarvestDegen() view returns (uint256)",
  "event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value)",
] as const;

export const MINT_ABI = [
  "function buyWithPLS(uint256 amount) external payable",
  "function nftPrice() view returns (uint256)",
  "function priceWithDiscount(uint256 amount, uint256 price) pure returns (uint256)",
  "function userPurchases(address user, uint256 index) view returns (uint256 amount, uint256 amountPaid, address tokenPaid)",
  "function previewBurnReturn(uint256 purchaseId, uint256 amount, bool isOink, address harvestInto) view returns (uint256)",
  "function burnNFT(uint256 purchaseId, bool isOink, uint256 amount, address harvestInto) external",
] as const;

export const PULSECHAIN = {
  chainId: CHAIN_HEX,
  chainName: "PulseChain",
  nativeCurrency: { name: "Pulse", symbol: "PLS", decimals: 18 },
  rpcUrls: ["https://rpc.pulsechain.com"],
  blockExplorerUrls: ["https://scan.pulsechain.com"],
};
