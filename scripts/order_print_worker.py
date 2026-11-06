"""Pull authenticated production jobs and prepare local Bambu projects (never print)."""
import argparse
import json
import logging
import os
from pathlib import Path
import subprocess
import sys
import urllib.request

ROOT = Path(__file__).resolve().parents[1]

def load_config():
    config = {}
    for line in (ROOT / '.env.local').read_text(encoding='utf-8-sig').splitlines():
        if '=' in line and not line.lstrip().startswith('#'):
            key, value = line.split('=', 1)
            config[key.strip()] = value.strip().strip('\"').strip("'")
    return dict(config, **os.environ)

def run_once():
    config = load_config()
    base = config.get('ORDER_WORKFLOW_URL', 'https://carls3d.se/api/order-workflow')
    token = config.get('ORDER_WORKFLOW_TOKEN', '')
    if not token or not base.startswith('https://'):
        raise ValueError('HTTPS workflow URL and ORDER_WORKFLOW_TOKEN required')
    output_root = Path(config.get('ORDER_PRINT_ROOT', r'D:\Documents\3D-prints\Beställningar'))
    staging = ROOT / 'data' / 'print-worker'
    staging.mkdir(parents=True, exist_ok=True)

    def request(suffix='', payload=None):
        data = None if payload is None else json.dumps(payload).encode()
        req = urllib.request.Request(base + suffix, data=data,
            headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json',
                     'User-Agent': 'Carls3D-OrderWorker/1.0'})
        # Do not forward credentials across redirects.
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *args, **kwargs):
                raise RuntimeError('Unexpected workflow redirect')
        with urllib.request.build_opener(NoRedirect).open(req, timeout=120) as response:
            return response.read()

    jobs = json.loads(request())
    for order in jobs:
        order_id = order.get('id')
        if type(order_id) is not int or order_id < 1:
            logging.error('Skipping invalid order id in queue response')
            continue
        job_dir = staging / str(order_id)
        job_dir.mkdir(exist_ok=True)
        ack_path = job_dir / 'result.json'
        try:
            if ack_path.exists():
                request(payload=json.loads(ack_path.read_text(encoding='utf-8')))
                continue
            manifest = job_dir / 'order.json'
            manifest.write_text(json.dumps(order, ensure_ascii=False, indent=2), encoding='utf-8')
            if order.get('type') != 'minecraft-torch':
                for index, item in enumerate(order.get('items', [])):
                    filename = item['filename']
                    if Path(filename).name != filename or '/' in filename or '\\' in filename:
                        raise ValueError('Invalid filename')
                    destination = job_dir / filename
                    if not destination.exists():
                        body = request('?id={}&file={}'.format(order_id, index))
                        temporary = destination.with_name(destination.name + '.part')
                        temporary.write_bytes(body)
                        temporary.replace(destination)
            command = [sys.executable, str(ROOT / 'scripts' / 'build_order_3mf.py'),
                str(manifest), '--uploads-dir', str(job_dir), '--output-root', str(output_root)]
            result = subprocess.run(command, capture_output=True, encoding='utf-8', errors='replace', timeout=1800,
                creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
            (job_dir / 'build.log').write_text(result.stdout + '\n' + result.stderr, encoding='utf-8')
            if result.returncode:
                # Preserve source files and an actionable record even for unsupported products.
                from build_order_3mf import order_folder_name
                review_dir = output_root / order_folder_name(order)
                if review_dir.exists():
                    # Never overwrite a user's existing or hand-edited order folder.
                    review_dir = job_dir / 'review'
                review_dir.mkdir(parents=True, exist_ok=True)
                import shutil
                shutil.copy2(str(manifest), str(review_dir / 'order.json'))
                for item in order.get('items', []):
                    source = job_dir / item['filename']
                    if source.is_file(): shutil.copy2(str(source), str(review_dir / source.name))
                (review_dir / 'REVIEW.txt').write_text('Print project needs manual review.\n' + result.stdout[-2000:] + result.stderr[-2000:], encoding='utf-8')
                acknowledgment = {'action': 'print', 'id': order_id, 'state': 'review', 'output': str(review_dir),
                    'error': 'Project generation needs review; see local REVIEW.txt and build.log.'}
            else:
                built = json.loads(result.stdout)
                project = Path(built['project'])
                if not project.is_file():
                    raise RuntimeError('Builder reported success but project is missing')
                acknowledgment = {'action': 'print', 'id': order_id, 'state': 'complete', 'output': str(project)}
            temporary = ack_path.with_suffix('.tmp')
            temporary.write_text(json.dumps(acknowledgment), encoding='utf-8')
            temporary.replace(ack_path)
            request(payload=acknowledgment)
            logging.info('Order %s: %s', order_id, acknowledgment['state'])
        except Exception:
            logging.exception('Order %s deferred; will retry next run', order_id)

if __name__ == '__main__':
    log_dir = ROOT / 'data' / 'print-worker'
    log_dir.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(filename=str(log_dir / 'worker.log'), level=logging.INFO,
        format='%(asctime)s %(levelname)s %(message)s')
    try:
        run_once()
    except Exception:
        logging.exception('Order polling failed')
        sys.exit(1)
