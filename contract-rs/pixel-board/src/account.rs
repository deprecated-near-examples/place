use crate::*;

use near_sdk::borsh::{self, BorshDeserialize, BorshSerialize};
use near_sdk::json_types::{ValidAccountId, U128};
use near_sdk::{env, near_bindgen, AccountId};

pub const PIXEL_COST: Balance = 1_000_000_000_000_000_000;
pub const DEFAULT_BALANCE: Balance = 100 * PIXEL_COST;
/// Current reward is 1 pixel per day per pixel.
pub const REWARD_PER_PIXEL_PER_NANOSEC: Balance = PIXEL_COST / (24 * 60 * 60 * 1_000_000_000);

pub type AccountIndex = u32;

#[derive(BorshDeserialize, BorshSerialize)]
pub struct Account {
    pub account_id: AccountId,
    pub account_index: AccountIndex,
    pub balance: u128,
    pub num_pixels: u32,
    pub claim_timestamp: u64,
}

impl Account {
    pub fn new(account_id: AccountId, account_index: AccountIndex) -> Self {
        Self {
            account_id,
            account_index,
            balance: DEFAULT_BALANCE.into(),
            num_pixels: 0,
            claim_timestamp: env::block_timestamp(),
        }
    }

    pub fn touch(&mut self) {
        let block_timestamp = env::block_timestamp();
        let time_diff = block_timestamp - self.claim_timestamp;
        self.balance += Balance::from(self.num_pixels + 1)
            * Balance::from(time_diff)
            * REWARD_PER_PIXEL_PER_NANOSEC;
        self.claim_timestamp = block_timestamp;
    }

    pub fn charge(&mut self, num_pixels: u32) {
        let cost = Balance::from(num_pixels) * PIXEL_COST;
        assert!(self.balance >= cost, "Not enough balance to draw pixels");
        self.balance -= cost;
    }
}

impl Place {
    pub fn get_account_by_id(&self, account_id: AccountId) -> Account {
        let account_index = self
            .account_indices
            .get(&account_id)
            .unwrap_or(self.accounts.len() as u32);
        self.accounts
            .get(u64::from(account_index))
            .map(|mut account| {
                account.touch();
                account
            })
            .unwrap_or_else(|| Account::new(account_id, account_index))
    }

    pub fn get_account_by_index(&self, account_index: AccountIndex) -> Option<Account> {
        self.accounts
            .get(u64::from(account_index))
            .map(|mut account| {
                account.touch();
                account
            })
    }

    pub fn save_account(&mut self, account: &Account) {
        if u64::from(account.account_index) >= self.accounts.len() {
            self.account_indices
                .insert(&account.account_id, &account.account_index);
            self.accounts.push(account);
        } else {
            self.accounts
                .replace(u64::from(account.account_index), account);
        }
    }
}

#[near_bindgen]
impl Place {
    pub fn get_pixel_cost(&self) -> U128 {
        PIXEL_COST.into()
    }

    pub fn get_account_balance(&self, account_id: ValidAccountId) -> U128 {
        self.get_account_by_id(account_id.into()).balance.into()
    }

    pub fn get_account_num_pixels(&self, account_id: ValidAccountId) -> u32 {
        self.get_account_by_id(account_id.into()).num_pixels
    }

    pub fn get_account_id_by_index(&self, account_index: AccountIndex) -> Option<AccountId> {
        self.accounts
            .get(u64::from(account_index))
            .map(|account| account.account_id)
    }
}
