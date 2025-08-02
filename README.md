# labitbu

### We will be back soon with something fun! <3 labitbu 👹

This is a fun project inspired by our plebfi 2025 second place hackathon project! @jarolrod @luisschwab @PlumBuggle68 

original hackathon project here

https://github.com/luisschwab/labubu-assets

# WARNING!!! THIS IS FOR FUN, IT MAY BE BROKEN, BE CAREFUL AND USE A NEW XVERSE ACCOUNT!!!!

## What make a labitbu a labitbu?? 

1. Labitbu's have to fill all 4096kb of the control block
2. Each labitbu will share the same internal NUMs key in the control block, we can use this to track them easier

### Labitbu internal key: 96053db5b18967b5a410326ecca687441579225a6d190f398e2180deec6e429e

## How it works 

1. create deposit address with xverse pubkey as the script spend
2. xverse pubkey is used to generate a labitbu with random traits (you can just fork this and change to whatever you want, but pls consider opening PR for new traits)
3. embeds the labibu in to the control block when we create the taproot address
4. Mint button creates a transaction spending from the labitbu contract address, revealing the control block and the labitbu hidden inside!

## example 

https://mempool.space/tx/3a779d02f3487eaad0af54747f3acfcbc43dfa001256d2ee2ba6faf8aeb0afc8

## Decoded a labitbu to webp

```
echo ‘<controlblock>‘ | tr -d '[:space:]' | grep -o -i -m1 '52494646[0-9a-f]*57454250[0-9a-f]*' | cut -c1-8192 | xxd -r -p > control.webp && open control.webp
```

## Labitbu explorer (bitcoin core)
cli getrawtransaction "txid" 2 "blockhash" \
| jq -r '.vin[0].txinwitness[2]' \
| tr -d '[:space:]' \
| grep -o -i -m1 '52494646[0-9a-f]*57454250[0-9a-f]*' \
| cut -c1-8192 \
| xxd -r -p > labitbu.webp && open labitbu.webp
```