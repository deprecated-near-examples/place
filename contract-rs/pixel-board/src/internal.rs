use crate::*;

pub(crate) fn assert_one_yocto() {
    assert_eq!(
        env::attached_deposit(),
        1,
        "Requires attached deposit of exactly 1 yoctoNEAR"
    )
}

pub(crate) fn assert_self() {
    assert_eq!(
        env::predecessor_account_id(),
        env::current_account_id(),
        "Method is private"
    );
}

impl Place {
    pub(crate) fn internal_deposit(&mut self, account_id: &AccountId, amount: Balance) {
        let mut account = self.get_mut_account(account_id.clone());
        let balance = account.balances[Berry::Banana as usize];

        if let Some(new_balance) = balance.checked_add(amount) {
            account.balances[Berry::Banana as usize] = new_balance;
            self.save_account(account);
        } else {
            env::panic(b"Balance overflow");
        }
    }

    pub(crate) fn internal_withdraw(&mut self, account_id: &AccountId, amount: Balance) {
        let mut account = self.get_mut_account(account_id.clone());
        let balance = account.balances[Berry::Banana as usize];

        if let Some(new_balance) = balance.checked_sub(amount) {
            account.balances[Berry::Banana as usize] = new_balance;
            self.save_account(account);
        } else {
            env::panic(b"The account doesn't have enough balance");
        }
    }

    pub(crate) fn internal_transfer(
        &mut self,
        sender_id: &AccountId,
        receiver_id: &AccountId,
        amount: Balance,
        memo: Option<String>,
    ) {
        assert_ne!(
            sender_id, receiver_id,
            "Sender and receiver should be different"
        );
        assert!(amount > 0, "The amount should be a positive number");
        self.internal_withdraw(sender_id, amount);
        self.internal_deposit(receiver_id, amount);
        env::log(format!("Transfer {} from {} to {}", amount, sender_id, receiver_id).as_bytes());
        if let Some(memo) = memo {
            env::log(format!("Memo: {}", memo).as_bytes());
        }
    }
}
