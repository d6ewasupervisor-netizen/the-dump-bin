import json
import os
import random

# Get list of images
image_files = [f for f in os.listdir('images') if f.endswith('.webp')]
upcs = [f.replace('.webp', '') for f in image_files]

# Ensure we have enough UPCs or recycle them if needed
# Pallet needs 170, Endcap needs 115. Total distinct needed? 
# The prompt implies they share images.
# I will just use what I have.

# --- Generate stores.json ---
stores = {}
# Specifics
stores["00005"] = "pallet"
stores["00011"] = "pallet"
stores["00021"] = "endcap"

# Fill the rest to reach 109 pallet and 16 endcap (Total 125)
pallet_count = 2 # already have 2
endcap_count = 1 # already have 1
store_num = 1
while (pallet_count < 109 or endcap_count < 16):
    s_id = f"{store_num:05d}"
    if s_id in stores:
        store_num += 1
        continue
    
    if pallet_count < 109:
        stores[s_id] = "pallet"
        pallet_count += 1
    elif endcap_count < 16:
        stores[s_id] = "endcap"
        endcap_count += 1
    store_num += 1

# Sort keys
sorted_stores = dict(sorted(stores.items()))

# --- Generate pallet.json ---
pallet_products = []
# 4 sides, 5 shelves. 170 items.
# Distribute roughly evenly.
# 170 / 4 = 42.5 items per side.
# Side 1: 43, Side 2: 43, Side 3: 42, Side 4: 42
items_per_side = [43, 43, 42, 42]
current_upc_idx = 0

for segment in range(1, 5):
    count = items_per_side[segment-1]
    # 5 shelves
    # roughly count/5 per shelf
    for i in range(count):
        shelf = (i % 5) + 1
        # positions: simple increment per shelf
        # Logic to group by shelf for position calculation would be better, but simple is ok for scaffolding.
        # Let's simple assign shelf and position later?
        # No, let's do it sequentially.
        pass

# Better approach: Iterate shelves per side
p_list = []
used_upcs = []

# Shuffle UPCs for variety
random.seed(42)
shuffled_upcs = upcs[:] # copy
# If not enough images, duplicate
while len(shuffled_upcs) < 170:
    shuffled_upcs.extend(upcs)
    
p_idx = 0
for segment in range(1, 5):
    # products for this segment
    seg_count = items_per_side[segment-1]
    # distribute into 5 shelves
    # e.g. 43 items / 5 shelves ~ 8 or 9 items
    shelf_counts = [0] * 5
    for k in range(seg_count):
        shelf_counts[k % 5] += 1
    
    # Create products for each shelf
    for shelf_idx in range(5):
        shelf_num = shelf_idx + 1 # 1 to 5
        num_items = shelf_counts[shelf_idx]
        for pos in range(1, num_items + 1):
            upc = shuffled_upcs[p_idx]
            p_idx += 1
            
            p = {
                "upc": upc,
                "name": f"Suncare Product {upc}", # Placeholder name
                "segment": segment,
                "shelf": shelf_num,
                "position": pos,
                "facings": 1,
                "isNew": random.choice([True, False]),
                "isMove": random.choice([True, False]),
                "isChange": False,
                "srp": random.choice(["SRP", ""]) if random.random() > 0.8 else ""
            }
            p_list.append(p)

pallet_data = {
    "id": "pallet",
    "name": "4-Sided Pallet",
    "subtitle": "HP 62IN SUNCARE 5 SHELF 1 PEG 4 SIDED PALLET",
    "pogNumber": "185-SUNTAN 680",
    "liveDate": "02-08-26",
    "sides": 4,
    "shelves": 5,
    "totalProducts": 170,
    "upcRedirects": {
        "0007214003517": "0007214003912",
        "0081008487202": "0081011561524",
        "0081008487122": "0081011561523",
        "0081008487384": "0081011561522"
    },
    "products": p_list
}

# --- Generate endcap.json ---
# 1 side, 6 shelves, 115 items
e_list = []
# 115 items
e_shuffled_upcs = upcs[:]
while len(e_shuffled_upcs) < 115:
    e_shuffled_upcs.extend(upcs)
    
e_idx = 0
segment = 1
# 115 / 6 ~ 19 items per shelf
shelf_counts_e = [0] * 6
for k in range(115):
    shelf_counts_e[k % 6] += 1

for shelf_idx in range(6):
    shelf_num = shelf_idx + 1
    num_items = shelf_counts_e[shelf_idx]
    for pos in range(1, num_items + 1):
        upc = e_shuffled_upcs[e_idx]
        e_idx += 1
        
        p = {
            "upc": upc,
            "name": f"Suncare Product {upc}",
            "segment": segment,
            "shelf": shelf_num,
            "position": pos,
            "facings": 1,
            "isNew": False, # Endcap usually false per prompt
            "isMove": False, # No isMove
            "isChange": False,
            "srp": "" # No SRP
        }
        e_list.append(p)

endcap_data = {
    "id": "endcap",
    "name": "4ft Endcap",
    "subtitle": "FRED MEYER SUNCARE 6 SHELF ENDCAP SEASONAL",
    "pogNumber": "185-SUNTAN 150",
    "liveDate": "02-08-26",
    "sides": 1,
    "shelves": 6,
    "totalProducts": 115,
    "upcRedirects": {
        "0007214003517": "0007214003912",
        "0081008487202": "0081011561524",
        "0081008487122": "0081011561523"
    },
    "products": e_list
}

if not os.path.exists('data'):
    os.makedirs('data')

with open('data/stores.json', 'w') as f:
    json.dump(sorted_stores, f, indent=2)

with open('data/pallet.json', 'w') as f:
    json.dump(pallet_data, f, indent=2)
    
with open('data/endcap.json', 'w') as f:
    json.dump(endcap_data, f, indent=2)
