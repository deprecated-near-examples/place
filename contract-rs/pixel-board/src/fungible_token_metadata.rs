use super::*;
use near_sdk::serde::Serialize;

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct FungibleTokenMetadata {
    version: String,
    name: String,
    symbol: String,
    url: String,
    decimals: u8,
}

pub trait FungibleTokenMetadataProvider {
    fn ft_metadata() -> FungibleTokenMetadata;
}

#[near_bindgen]
impl FungibleTokenMetadataProvider for Place {
    fn ft_metadata() -> FungibleTokenMetadata {
        FungibleTokenMetadata {
            version: String::from("0.1.0"),
            name: String::from("Banana"),
            symbol: String::from("BANANA"),
            url: String::from("https://github.com/evgenykuzyakov/berryclub"),
            decimals: 18,
        }
    }
}
