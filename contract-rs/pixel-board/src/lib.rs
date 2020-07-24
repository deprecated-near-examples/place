use near_sdk::borsh::{self, BorshDeserialize, BorshSerialize};
use near_sdk::collections::{UnorderedMap, Vector};
use near_sdk::{env, near_bindgen, AccountId, Balance};

pub mod account;
pub use crate::account::*;

pub mod board;
pub use crate::board::*;

#[global_allocator]
static ALLOC: near_sdk::wee_alloc::WeeAlloc<'_> = near_sdk::wee_alloc::WeeAlloc::INIT;

#[near_bindgen]
#[derive(BorshDeserialize, BorshSerialize)]
pub struct Place {
    pub account_indices: UnorderedMap<AccountId, u32>,
    pub board: board::PixelBoard,
    pub accounts: Vector<Account>,
}

impl Default for Place {
    fn default() -> Self {
        panic!("Fun token should be initialized before usage")
    }
}

#[near_bindgen]
impl Place {
    #[init]
    pub fn new() -> Self {
        assert!(!env::state_exists(), "Already initialized");
        let mut place = Self {
            account_indices: UnorderedMap::new(b"i".to_vec()),
            board: PixelBoard::new(),
            accounts: Vector::new(b"a".to_vec()),
        };

        let mut account = place.get_account_by_id(env::current_account_id());
        account.num_pixels = TOTAL_NUM_PIXELS;
        place.save_account(&account);

        place
    }

    #[payable]
    pub fn buy_tokens(&mut self) {
        unimplemented!();
    }

    pub fn draw(&mut self, pixels: Vec<SetPixelRequest>) {
        let mut account = self.get_account_by_id(env::predecessor_account_id());
        let new_pixels = pixels.len() as u32;
        account.charge(new_pixels);

        let mut old_owners = self.board.set_pixels(account.account_index, &pixels);
        let replaced_pixels = old_owners.remove(&account.account_index).unwrap_or(0);
        account.num_pixels += new_pixels - replaced_pixels;
        self.save_account(&account);

        for (account_index, num_pixels) in old_owners {
            let mut account = self.get_account_by_index(account_index).unwrap();
            account.num_pixels -= num_pixels;
            self.save_account(&account);
        }
    }
}
