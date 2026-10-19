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
// CONFIG.minMpReserve = 100;

// pot caps (per stat — hp and mp counted separately)
// CONFIG.potionMin = 200;            // fighter pulls from the merchant below this
// CONFIG.potionMax = 1000;           // fighter cap; excess funnels back
// CONFIG.potionMaxMerchant = 4000;   // merchant cap; excess is vendored
// CONFIG.supplyKeep = 75;            // merchant floor / emergency dump floor
// CONFIG.goldReserve = 2000;         // gold never spent on potions

// unified timing (every throttle/backoff in the party)
// CONFIG.retryEvery = 30000;
// CONFIG.tripBackoff = 180000;
// CONFIG.tripBackoffHard = 900000;
// CONFIG.tripTimeout = 90000;
// CONFIG.legEvery = 10000;
// CONFIG.stuckAfter = 10000;
// CONFIG.deliverEvery = 60000;
// CONFIG.supplyEvery = 300000;
