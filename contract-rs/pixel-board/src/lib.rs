use near_sdk::borsh::{self, BorshDeserialize, BorshSerialize};
use near_sdk::collections::{UnorderedMap, Vector};
use near_sdk::{env, near_bindgen, AccountId, Balance, PanicOnDefault};

pub mod account;
pub use crate::account::*;

pub mod board;
pub use crate::board::*;

#[global_allocator]
static ALLOC: near_sdk::wee_alloc::WeeAlloc<'_> = near_sdk::wee_alloc::WeeAlloc::INIT;

#[near_bindgen]
#[derive(BorshDeserialize, BorshSerialize, PanicOnDefault)]
pub struct Place {
    pub account_indices: UnorderedMap<AccountId, u32>,
    pub board: board::PixelBoard,
    pub accounts: Vector<Account>,
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

#[cfg(not(target_arch = "wasm32"))]
#[cfg(test)]
mod tests {
    use super::*;

    use near_sdk::{testing_env, MockedBlockchain, VMContext};

    pub fn get_context(block_timestamp: u64, is_view: bool) -> VMContext {
        VMContext {
            current_account_id: "place.meta".to_string(),
            signer_account_id: "place.meta".to_string(),
            signer_account_pk: vec![0, 1, 2],
            predecessor_account_id: "place.meta".to_string(),
            input: vec![],
            block_index: 1,
            block_timestamp,
            epoch_height: 1,
            account_balance: 10u128.pow(26),
            account_locked_balance: 0,
            storage_usage: 10u64.pow(6),
            attached_deposit: 0,
            prepaid_gas: 300 * 10u64.pow(12),
            random_seed: vec![0, 1, 2],
            is_view,
            output_data_receivers: vec![],
        }
    }

    #[test]
    fn test_new() {
        let mut context = get_context(3_600_000_000_000, false);
        testing_env!(context.clone());
        let contract = Place::new();

        context.is_view = true;
        testing_env!(context.clone());
        assert_eq!(contract.get_pixel_cost().0, PIXEL_COST);
        assert_eq!(
            contract.get_line_versions(),
            vec![0u32; BOARD_HEIGHT as usize]
        );
    }
}
