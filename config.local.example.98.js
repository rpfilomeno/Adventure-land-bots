// config.local.example.98.js — template for slot 98 (local config).
//
// 1. copy this file to "config.local.98.js" (gitignored, stays on your machine)
// 2. fill in your real character names
// 3. upload it to code slot 98 (the AL VSCode sync extension picks up the
//    name.slot.js filename automatically)
// 4. Common.99.js runs load_code(98) after building CONFIG, so these stick.
//
// Delete the placeholder lines you don't override.

CONFIG.ranger = "YourRangerName";                                  // leader / target picker
CONFIG.tank = "YourTankName";                                      // main tank
CONFIG.priest = "YourPriestName";                                  // healer
CONFIG.merchant = "YourMerchantName";                              // mule / supplier
CONFIG.party = ["YourRangerName", "YourTankName",
	"YourPriestName", "YourMerchantName"];                          // everyone, ranger first

// optional tuning overrides:
// CONFIG.monsters = ["goo"];
// CONFIG.tankMinHp = 0.65;
// CONFIG.tankCritHp = 0.30;
// CONFIG.followDist = 30;
// CONFIG.kiteMax = 600;
// CONFIG.potionMin = 20;
// CONFIG.minMpReserve = 100;
