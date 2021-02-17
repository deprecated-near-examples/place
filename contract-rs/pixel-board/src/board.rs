use crate::*;

use near_sdk::borsh::{self, BorshDeserialize, BorshSerialize};
use near_sdk::collections::Vector;
use near_sdk::json_types::Base64VecU8;
use near_sdk::near_bindgen;
use near_sdk::serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub const BOARD_WIDTH: u32 = 50;
pub const BOARD_HEIGHT: u32 = 50;
pub const TOTAL_NUM_PIXELS: u32 = BOARD_WIDTH * BOARD_HEIGHT;

#[derive(BorshDeserialize, BorshSerialize, Copy, Clone)]
pub struct Pixel {
    pub color: u32,
    pub owner_id: AccountIndex,
}

impl Default for Pixel {
    fn default() -> Self {
        Self {
            color: 0xffffff,
            owner_id: 0,
        }
    }
}

#[derive(BorshDeserialize, BorshSerialize)]
pub struct PixelLine(pub Vec<Pixel>);

impl Default for PixelLine {
    fn default() -> Self {
        Self(vec![Pixel::default(); BOARD_WIDTH as usize])
    }
}

#[derive(BorshDeserialize, BorshSerialize)]
pub struct PixelBoard {
    pub lines: Vector<PixelLine>,
    pub line_versions: Vec<u32>,
}

#[derive(Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde")]
pub struct SetPixelRequest {
    pub x: u32,
    pub y: u32,
    pub color: u32,
}

impl SetPixelRequest {
    pub fn assert_valid(&self) {
        assert!(self.x < BOARD_WIDTH, "X is out of bounds");
        assert!(self.y < BOARD_HEIGHT, "Y is out of bounds");
        assert!(self.color <= 0xffffff, "Color is out of bounds");
    }
}

impl PixelBoard {
    pub fn new() -> Self {
        let mut board = Self {
            lines: Vector::new(b"p".to_vec()),
            line_versions: vec![0; BOARD_HEIGHT as usize],
        };
        let default_line = PixelLine::default();
        for _ in 0..BOARD_HEIGHT {
            board.lines.push(&default_line);
        }
        board
    }

    pub fn get_line(&self, index: u32) -> PixelLine {
        self.lines.get(u64::from(index)).unwrap()
    }

    /// Returns the list of the old owner IDs for the replaced pixels
    pub fn set_pixels(
        &mut self,
        new_owner_id: u32,
        pixels: &[SetPixelRequest],
    ) -> HashMap<AccountIndex, u32> {
        let mut lines = HashMap::new();
        let mut old_owners = HashMap::new();
        for request in pixels {
            request.assert_valid();
            let line = lines
                .entry(request.y)
                .or_insert_with(|| self.lines.get(u64::from(request.y)).unwrap());
            let old_owner = line.0[request.x as usize].owner_id;
            line.0[request.x as usize] = Pixel {
                owner_id: new_owner_id,
                color: request.color,
            };
            *old_owners.entry(old_owner).or_default() += 1;
        }
        for (i, line) in lines {
            self.save_line(i, &line);
        }
        old_owners
    }

    fn save_line(&mut self, index: u32, line: &PixelLine) {
        self.lines.replace(u64::from(index), line);
        self.line_versions[index as usize] += 1;
    }
}

#[near_bindgen]
impl Place {
    pub fn get_lines(&self, lines: Vec<u32>) -> Vec<Base64VecU8> {
        lines
            .into_iter()
            .map(|i| {
                let line = self.board.get_line(i);
                line.try_to_vec().unwrap().into()
            })
            .collect()
    }

    pub fn get_line_versions(&self) -> Vec<u32> {
        self.board.line_versions.clone()
    }
}
