export type RewardToken = "OINK" | "DEGEN";

export type Destination = {
  label: string;
  address: string | null;
  payoutPct: number;
};

export const HARVEST_DESTINATIONS: Record<RewardToken, Destination[]> = {
  OINK: [
    {
      label: "5 Year OINK Pool (default)",
      payoutPct: 100,
      address: "0xf3E82f4123d4262a2baEC25b03652f3932A91739",
    },
    {
      label: "3 Year OINK Pool",
      payoutPct: 25,
      address: "0x15b51Ece819f3B51ce814de67bB2419660701a3c",
    },
    {
      label: "3 Month OINK Pool",
      payoutPct: 10,
      address: "0xc0483f1b0dcf601888fFD0d3A44b7124e80DB7D1",
    },
    {
      label: "1 Year OINK Pool",
      payoutPct: 5,
      address: "0xb180450f064E79adBFD71Bc2fB086F9CD0Af0D67",
    },
    {
      label: "6 Month OINK Pool",
      payoutPct: 3,
      address: "0x9013B1067C52E897E713044dE36c56BfdA8Ec9B4",
    },
    {
      label: "1 Month OINK Pool",
      payoutPct: 1,
      address: "0x39b3E852D6fFA1aF6694Ef87C062450de6778da8",
    },
    { label: "Into Wallet", payoutPct: 0.5, address: null },
  ],
  DEGEN: [
    {
      label: "10 Year DEGEN Pool (default)",
      payoutPct: 100,
      address: "0xdE672FccA32365bD704c39bd1164a0D34a3a73e6",
    },
    {
      label: "1 Year DEGEN Pool",
      payoutPct: 5,
      address: "0x3d175C8359169b0e830d36EA9CD3FE209f46f7BD",
    },
    {
      label: "3 Month DEGEN Pool",
      payoutPct: 2.5,
      address: "0x7ED33f65A0398cb26eaB2B03877825c96D9B6077",
    },
    {
      label: "1 Month DEGEN Pool",
      payoutPct: 1,
      address: "0xd9b491ac0f5487673500b67224b67b4171a08aca",
    },
    { label: "Into Wallet", payoutPct: 0.5, address: null },
  ],
};

export const SETTINGS_POOLS = {
  OINK: HARVEST_DESTINATIONS.OINK.filter((option) => option.address)
    .map((option) => ({
      label: option.label.replace(" OINK Pool", ""),
      address: option.address!,
    }))
    .reverse(),
  DEGEN: HARVEST_DESTINATIONS.DEGEN.filter((option) => option.address)
    .map((option) => ({
      label: option.label.replace(" DEGEN Pool", ""),
      address: option.address!,
    }))
    .reverse(),
};

export const BURN_DESTINATIONS: Record<RewardToken, Destination[]> = {
  DEGEN: [
    {
      label: "10 Year DEGEN Pool",
      payoutPct: 100,
      address: "0xdE672FccA32365bD704c39bd1164a0D34a3a73e6",
    },
    {
      label: "1 Year DEGEN Pool",
      payoutPct: 85,
      address: "0x3d175C8359169b0e830d36EA9CD3FE209f46f7BD",
    },
    {
      label: "3 Month DEGEN Pool",
      payoutPct: 80,
      address: "0x7ED33f65A0398cb26eaB2B03877825c96D9B6077",
    },
    {
      label: "1 Month DEGEN Pool",
      payoutPct: 75,
      address: "0xd9b491ac0f5487673500b67224b67b4171a08aca",
    },
    { label: "Into Wallet", payoutPct: 0.5, address: null },
  ],
  OINK: [
    {
      label: "5 Year OINK Pool",
      payoutPct: 100,
      address: "0xf3E82f4123d4262a2baEC25b03652f3932A91739",
    },
    {
      label: "3 Year OINK Pool",
      payoutPct: 90,
      address: "0x15b51Ece819f3B51ce814de67bB2419660701a3c",
    },
    {
      label: "1 Year OINK Pool",
      payoutPct: 85,
      address: "0xb180450f064E79adBFD71Bc2fB086F9CD0Af0D67",
    },
    {
      label: "6 Month OINK Pool",
      payoutPct: 80,
      address: "0x9013B1067C52E897E713044dE36c56BfdA8Ec9B4",
    },
    {
      label: "3 Month OINK Pool",
      payoutPct: 75,
      address: "0xc0483f1b0dcf601888fFD0d3A44b7124e80DB7D1",
    },
    {
      label: "1 Month OINK Pool",
      payoutPct: 70,
      address: "0x39b3E852D6fFA1aF6694Ef87C062450de6778da8",
    },
    { label: "Into Wallet", payoutPct: 0.5, address: null },
  ],
};
