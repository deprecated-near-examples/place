use crate::*;

use near_sdk::borsh::{self, BorshDeserialize, BorshSerialize};
use near_sdk::json_types::{ValidAccountId, U128};
use near_sdk::{env, near_bindgen, AccountId};

pub const PIXEL_COST: Balance = 1_000_000_000_000_000_000;
pub const ONE_NEAR: Balance = 1_000_000_000_000_000_000_000_000;
pub const PIXEL_TOKEN_PRICE: Balance = ONE_NEAR / PIXEL_COST / 250;
pub const MIN_AMOUNT_FOR_DISCOUNT: Balance = 5 * ONE_NEAR;
pub const PIXEL_TOKEN_PRICE_WITH_DISCOUNT: Balance = PIXEL_TOKEN_PRICE * 5 / 6;
pub const DEFAULT_AVOCADO_BALANCE: Balance = 25 * PIXEL_COST;
pub const DEFAULT_BANANA_BALANCE: Balance = 0;
/// Current reward is 1 pixel per day per pixel.
pub const REWARD_PER_PIXEL_PER_NANOSEC: Balance = PIXEL_COST / (24 * 60 * 60 * 1_000_000_000);

pub type AccountIndex = u32;

#[derive(BorshDeserialize, BorshSerialize)]
pub struct AccountVersionAvocado {
    pub account_id: AccountId,
    pub account_index: AccountIndex,
    pub balance: u128,
    pub num_pixels: u32,
    pub claim_timestamp: u64,
}

impl From<AccountVersionAvocado> for Account {
    fn from(account: AccountVersionAvocado) -> Self {
        Self {
            account_id: account.account_id,
            account_index: account.account_index,
            balances: vec![account.balance, 0],
            num_pixels: account.num_pixels,
            claim_timestamp: account.claim_timestamp,
            farming_preference: Berry::Avocado,
        }
    }
}

#[derive(BorshDeserialize, BorshSerialize)]
pub enum UpgradableAccount {
    BananaAccount(Account),
}

impl From<UpgradableAccount> for Account {
    fn from(account: UpgradableAccount) -> Self {
        match account {
            UpgradableAccount::BananaAccount(account) => account,
        }
    }
}

impl From<Account> for UpgradableAccount {
    fn from(account: Account) -> Self {
        UpgradableAccount::BananaAccount(account)
    }
}

#[derive(BorshDeserialize, BorshSerialize)]
pub struct Account {
    pub account_id: AccountId,
    pub account_index: AccountIndex,
    pub balances: Vec<Balance>,
    pub num_pixels: u32,
    pub claim_timestamp: u64,
    pub farming_preference: Berry,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct HumanAccount {
    pub account_id: AccountId,
    pub account_index: AccountIndex,
    pub avocado_balance: U128,
    pub banana_balance: U128,
    pub num_pixels: u32,
    pub farming_preference: Berry,
}

impl From<Account> for HumanAccount {
    fn from(account: Account) -> Self {
        Self {
            account_id: account.account_id,
            account_index: account.account_index,
            avocado_balance: account.balances[Berry::Avocado as usize].into(),
            banana_balance: account.balances[Berry::Banana as usize].into(),
            num_pixels: account.num_pixels,
            farming_preference: account.farming_preference,
        }
    }
}

impl Account {
    pub fn new(account_id: AccountId, account_index: AccountIndex) -> Self {
        Self {
            account_id,
            account_index,
            balances: vec![DEFAULT_AVOCADO_BALANCE, DEFAULT_BANANA_BALANCE],
            num_pixels: 0,
            claim_timestamp: env::block_timestamp(),
            farming_preference: Berry::Avocado,
        }
    }

    /// Buying avocados
    pub fn buy_tokens(&mut self, near_amount: Balance) -> Balance {
        let amount = if near_amount >= MIN_AMOUNT_FOR_DISCOUNT {
            near_amount / PIXEL_TOKEN_PRICE_WITH_DISCOUNT
        } else {
            near_amount / PIXEL_TOKEN_PRICE
        };
        env::log(
            format!(
                "Purchased {}.{:03} Avocado tokens for {}.{:03} NEAR",
                amount / PIXEL_COST,
                (amount - amount / PIXEL_COST * PIXEL_COST) / (PIXEL_COST / 1000),
                near_amount / ONE_NEAR,
                (near_amount - near_amount / ONE_NEAR * ONE_NEAR) / (ONE_NEAR / 1000),
            )
            .as_bytes(),
        );
        self.balances[Berry::Avocado as usize] += amount;
        amount
    }

    pub fn touch(&mut self) -> (Berry, Balance) {
        let block_timestamp = env::block_timestamp();
        let time_diff = block_timestamp - self.claim_timestamp;
        let farm_bonus = if self.farming_preference == Berry::Avocado {
            1
        } else {
            0
        };
        let farmed = Balance::from(self.num_pixels + farm_bonus)
            * Balance::from(time_diff)
            * REWARD_PER_PIXEL_PER_NANOSEC;
        self.claim_timestamp = block_timestamp;
        self.balances[self.farming_preference as usize] += farmed;
        (self.farming_preference, farmed)
    }

    pub fn charge(&mut self, berry: Berry, num_pixels: u32) -> Balance {
        let cost = Balance::from(num_pixels) * PIXEL_COST;
        assert!(
            self.balances[berry as usize] >= cost,
            "Not enough balance to draw pixels"
        );
        self.balances[berry as usize] -= cost;
        cost
    }
}

impl Place {
    pub fn get_internal_account_by_id(&self, account_id: &AccountId) -> Option<Account> {
        self.account_indices
            .get(&account_id)
            .and_then(|account_index| self.get_internal_account_by_index(account_index))
    }

    pub fn get_mut_account(&mut self, account_id: AccountId) -> Account {
        let mut account = self
            .get_internal_account_by_id(&account_id)
            .unwrap_or_else(|| Account::new(account_id, self.num_accounts));
        self.touch(&mut account);
        account
    }

    pub fn get_internal_account_by_index(&self, account_index: AccountIndex) -> Option<Account> {
        self.accounts
            .get(&account_index)
            .map(|account| account.into())
            .or_else(|| {
                self.legacy_accounts
                    .get(u64::from(account_index))
                    .map(|legacy_account| legacy_account.into())
            })
    }

    pub fn touch(&mut self, account: &mut Account) {
        let (berry, farmed) = account.touch();
        if farmed > 0 {
            self.farmed_balances[berry as usize] += farmed;
        }
    }

    pub fn save_account(&mut self, account: Account) {
        let account_index = account.account_index;
        if account_index >= self.num_accounts {
            self.account_indices
                .insert(&account.account_id, &account_index);
            self.accounts.insert(&account_index, &account.into());
            self.num_accounts += 1;
        } else if self
            .accounts
            .insert(&account_index, &account.into())
            .is_none()
        {
            // Need to delete the old value using a hack. This will make the vector inconsistent
            let mut raw_key = [b'a'; 1 + core::mem::size_of::<u64>()];
            raw_key[1..].copy_from_slice(&(u64::from(account_index).to_le_bytes()[..]));
            env::storage_remove(&raw_key);
        }
    }
}

#[near_bindgen]
impl Place {
    pub fn get_pixel_cost(&self) -> U128 {
        PIXEL_COST.into()
    }

    pub fn get_account_by_index(&self, account_index: AccountIndex) -> Option<HumanAccount> {
        self.get_internal_account_by_index(account_index)
            .map(|mut account| {
                account.touch();
                account.into()
            })
    }

    pub fn get_account(&self, account_id: ValidAccountId) -> Option<HumanAccount> {
        self.get_internal_account_by_id(account_id.as_ref())
            .map(|mut account| {
                account.touch();
                account.into()
            })
    }

    pub fn get_account_balance(&self, account_id: ValidAccountId) -> U128 {
        self.get_internal_account_by_id(account_id.as_ref())
            .map(|mut account| {
                account.touch();
                account.balances[Berry::Avocado as usize]
            })
            .unwrap_or(DEFAULT_AVOCADO_BALANCE)
            .into()
    }

    pub fn get_account_num_pixels(&self, account_id: ValidAccountId) -> u32 {
        self.get_internal_account_by_id(account_id.as_ref())
            .map(|account| account.num_pixels)
            .unwrap_or(0)
    }

    pub fn get_account_id_by_index(&self, account_index: AccountIndex) -> Option<AccountId> {
        self.get_internal_account_by_index(account_index)
            .map(|account| account.account_id)
    }
}
