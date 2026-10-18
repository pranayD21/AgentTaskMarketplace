# VM live viewer

A local page that shows, live, what each seller VM is doing: CPU, memory and processes, the seller's Wassette log, the task's path through the marketplace, and the model's prompt and tokens as they are generated.

**Demo only.** The Ollama tap shows task prompts and answers, which the marketplace otherwise keeps private.

```sh
pnpm vm:viewer          # http://localhost:5180, opens a browser window
```

It finds Lima VMs with `limactl list` every 3 s. When a new VM appears, it opens a window for that VM (`VM_VIEWER_AUTO_OPEN=0` turns this off). `MARKETPLACE_BASE_URL` sets the marketplace origin (default `http://localhost:3000`).

## Seller VM setup

Copy the repo to `~/atm` in the VM, run `pnpm install`, and install Wassette 0.8 and Ollama with a model. Then start the seller from the host, which also creates a reverse tunnel to the marketplace:

```sh
ssh -F ~/.lima/<vm>/ssh.config -R 3000:localhost:3000 lima-<vm> 'bash ~/atm/apps/vm-viewer/vm/start-seller.sh'
```

`vm/start-seller.sh` starts `vm/ollama-tap.mjs` on port 11435 in front of Ollama. It then runs the Wassette seller against the tap and logs to `~/atm/.atm-state/vm-viewer/`, where the viewer tails it. The tap streams tokens from Ollama, records them, and returns the single JSON reply the runner expects.
