"""Assemble CL04 evidence from completed checks; never runs performance/selection."""
from pathlib import Path
import json
import re
import hashlib
import subprocess
import difflib
from collections import Counter

root=Path('reports/cl04')
load=lambda p:json.loads(Path(p).read_text())
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
dump=lambda p,v:Path(p).write_text(json.dumps(v,indent=2,allow_nan=False)+'\n')
checkpoint=load(root/'baseline/checkpoint.json')
allowed={'research/capital/'+p for p in ['README.md','engine.ts','metrics.ts','registry.ts','storage.ts']}
changed=[p for p,h in checkpoint['hashes'].items() if sha(p)!=h]
assert set(changed)==allowed, changed
archived={p:sha(root/'baseline'/p)==h for p,h in checkpoint['hashes'].items() if p.startswith('research/capital/')}
assert all(archived.values())
protected={p:h for p,h in checkpoint['hashes'].items() if p not in allowed}
assert all(sha(p)==h for p,h in protected.items())
branch=subprocess.check_output(['git','branch','--show-current'],text=True).strip()
commit=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()
assert branch==checkpoint['branch'] and commit==checkpoint['commit']
status=subprocess.check_output(['git','status','--short'],text=True)
(root/'final-git-status.txt').write_text(status)
diffcheck=subprocess.run(['git','diff','--check'],capture_output=True,text=True)
assert diffcheck.returncode==0,diffcheck.stdout+diffcheck.stderr
(root/'diff-check.txt').write_text(diffcheck.stdout+diffcheck.stderr)
typecheck=subprocess.run(['./node_modules/.bin/tsc','--noEmit','--module','esnext','--moduleResolution','bundler','--target','es2022','--types','node','--typeRoots','artifacts/api-server/node_modules/@types','--skipLibCheck','--strict',*map(str,Path('research/capital').glob('*.ts'))],capture_output=True,text=True)
(root/'typecheck.txt').write_text(typecheck.stdout+typecheck.stderr)
assert typecheck.returncode==0,typecheck.stdout+typecheck.stderr
source_paths=sorted(p for p in Path('research/capital').iterdir() if p.is_file())
whitespace=[]
for p in source_paths:
    check=subprocess.run(['git','diff','--no-index','--check','/dev/null',str(p)],capture_output=True,text=True)
    # no-index exits 1 for differences, even when --check has no errors.
    assert not (check.stdout+check.stderr),str(p)+check.stdout+check.stderr
    assert check.returncode in [0,1]
    whitespace.append(dict(path=str(p),exit_code=check.returncode,whitespace_errors=0))
dump(root/'source-whitespace.json',whitespace)
patch=''
for p in sorted(allowed):
    patch+=''.join(difflib.unified_diff((root/'baseline'/p).read_text().splitlines(True),Path(p).read_text().splitlines(True),fromfile='CL04-baseline/'+p,tofile=p))
(root/'research-hardening.patch').write_text(patch)
dump(root/'research-code-hashes.json',{str(p):sha(p) for p in source_paths})
preservation=dict(status='PASS',branch=branch,commit=commit,checkpoint_files=len(checkpoint['hashes']),
                 protected_files_unchanged=len(protected),authorized_research_changes=changed,
                 original_research_archives=archived,protected_hashes=protected,git_status=status)
dump(root/'preservation.json',preservation)
unit=load(root/'unit-verification.json');assert unit['failed']==0 and unit['passed']==175
log=(root/'validation-tests-final.txt').read_text()
cases=[dict(name=m.group(1),status='PASS',elapsed_ms=float(m.group(2))) for m in re.finditer(r'^✔ (.*?) \(([\d.]+)ms\)$',log,re.M)]
assert len(cases)==199 and 'ℹ fail 0' in log and 'ℹ skipped 0' in log
assert sum(c['name'].startswith('CL03') for c in cases)==16
assert sum(c['name'].startswith('CL04 regression') for c in cases)==8
replay=load(root/'independent-replay.json');assert replay['status']=='PASS' and len(replay['campaigns'])==12
loads=[load(root/f'scale-{n}/load-verification.json') for n in [10,50,100,200]]
for x in loads:
    assert x['status']=='PASS' and x['executed_jobs']==x['plan']['backtests_estimated'] and x['resume_new_jobs']==0
    assert x['telemetry']['model_fits_succeeded']==2
    campaign_root=root/f"scale-{x['plan']['unique_candidates']}"
    x['final_artifact_bytes_including_charts']=sum(p.stat().st_size for p in campaign_root.rglob('*') if p.is_file())
dump(root/'scale-verification.json',dict(status='PASS',campaigns=loads))
snapshot_paths=[p for p in root.rglob('*') if p.is_file() and p.name in ['manifest.json','campaign.qa.json','campaign.frozen.json','candidate-space.json','qa-data.json','code-hashes.json','dry-run.json']]
dump(root/'config-data-manifest-hashes.json',{str(p):sha(p) for p in sorted(snapshot_paths)})
commands=[
 dict(command='node dist/cl04/hardening-regressions.test.js (six initial regressions)',cwd='artifacts/api-server',exit_code=1,evidence='pre-hardening-tests.txt',result='0 PASS / 6 FAIL'),
 dict(command='node dist/cl04/hardening-regressions.test.js (post six fixes)',cwd='artifacts/api-server',exit_code=0,evidence='post-hardening-tests.txt',result='6 PASS'),
 dict(command='node dist/cl04/hardening-regressions.test.js (correlation regression)',cwd='artifacts/api-server',exit_code=1,evidence='pre-correlation-fix.txt',result='6 PASS / 1 FAIL'),
 dict(command='node artifacts/api-server/dist/cl04/validation.test.js',cwd='repository root',exit_code=0,evidence='validation-tests-first.txt',result='195 PASS'),
 dict(command='node dist/cl04/hardening-regressions.test.js (CSV regression)',cwd='artifacts/api-server',exit_code=1,evidence='pre-csv-fix.txt',result='7 PASS / 1 FAIL'),
 dict(command='./node_modules/.bin/esbuild ../../research/capital/validation.test.ts ../../research/capital/qa-campaign.ts --bundle --platform=node --format=esm --packages=external --alias:@workspace/db=./src/lib/calculator.a1.db-shim.ts --outdir=dist/cl04',cwd='artifacts/api-server',exit_code=0),
 dict(command='node dist/cl04/validation.test.js (incorrect fixture working directory)',cwd='artifacts/api-server',exit_code=1,evidence='validation-runner-cwd-error.txt',result='source-relative fixture ENOENT; rerun from root'),
 dict(command='node artifacts/api-server/dist/cl04/validation.test.js',cwd='repository root',exit_code=0,evidence='validation-tests-final.txt',result='199 PASS / 0 FAIL / 0 SKIP'),
 dict(command='tsc --noEmit --module esnext --moduleResolution bundler --target es2022 --types node --typeRoots artifacts/api-server/node_modules/@types --skipLibCheck --strict research/capital/*.ts (initial QA runner)',cwd='repository root',exit_code=2,evidence='typecheck-first.txt',result='new fixture syntax error; fixed closing brace'),
 dict(command='tsc --noEmit --module esnext --moduleResolution bundler --target es2022 --types node --typeRoots artifacts/api-server/node_modules/@types --skipLibCheck --strict research/capital/*.ts',cwd='repository root',exit_code=typecheck.returncode,evidence='typecheck.txt',result='PASS'),
 dict(command='git diff --check',cwd='repository root',exit_code=diffcheck.returncode,evidence='diff-check.txt',result='PASS'),
 dict(command='git diff --no-index --check /dev/null research/capital/<file> (each source)',cwd='repository root',exit_codes=sorted(set(w['exit_code'] for w in whitespace)),evidence='source-whitespace.json',result='no whitespace errors'),
 dict(command='python research/capital/replay.py <8 QA + 2 frozen CL03 roots> (initial adapter)',cwd='repository root',exit_code=1,evidence='replay-adapter-order-error.txt',result='CL03 interleaved fold CSV order; independent oracle now compares semantic fold keys'),
 dict(command='python research/capital/replay.py reports/cl04/scale-{10,50,100,200} reports/cl04/replay-{traditional,nested,overfit-traditional,overfit-nested} reports/cl04/failure-{fit_failure,prediction_failure} reports/capital-research/cl03-acceptance-{traditional,nested} (shell braces expanded)',cwd='repository root',exit_code=0,evidence='independent-replay.txt',result='12 campaigns PASS; no engine selection calls'),
]
for label in ['10','50','100','200','traditional','nested','overfit-traditional','overfit-nested']:
    commands.append(dict(command=f'node artifacts/api-server/dist/cl04/qa-campaign.js {label}',cwd='repository root',exit_code=0,evidence=f'{"scale" if label.isdigit() else "replay"}-{label}-execution.txt'))
commands.extend([dict(command='MPLCONFIGDIR=/tmp/cl04-mpl XDG_CACHE_HOME=/tmp/cl04-cache python research/capital/render.py <8 QA roots>',exit_code=0,evidence='render.txt'),
 dict(command='MPLCONFIGDIR=/tmp/cl04-mpl XDG_CACHE_HOME=/tmp/cl04-cache python research/capital/render.py <2 preserved failure fixtures>',exit_code=0,evidence='failure-render.txt'),
 dict(command='python research/capital/render.py --compare <traditional> <nested> <comparison destination> (same-winner and overfit pairs)',exit_code=0,evidence='same-winner-comparison/ and overfit-comparison/')])
dump(root/'commands.json',commands)
criteria_names=['known_answer','fold_oracle','leakage_mutation','metrics_oracle','accounting_reconciliation','grid_random_budget',
 'cache_isolation','resume_failure_recovery','persistence_roundtrip','traditional_nested_consistency','qa_200_complete',
 'independent_replay','strict_typecheck','git_diff_check','baseline_production_preservation']
evidence=['validation-tests-final.txt','unit-verification.json','unit-verification.json','oracle.ts + independent-replay.json',
 'independent-replay.json','unit-verification.json','validation-tests-final.txt','validation-tests-final.txt',
 'independent-replay.json','same-winner-comparison/ + overfit-comparison/','scale-200/load-verification.json',
 'independent-replay.json','typecheck.txt','diff-check.txt + source-whitespace.json','preservation.json']
criteria=[dict(id=i+1,criterion=name,status='PASS',evidence=e) for i,(name,e) in enumerate(zip(criteria_names,evidence))]
areas=[('A','Correctness',['Correctness']),('B','Leakage',['Leakage']),('C','Reproducibility',['Consistency','Resume']),
 ('D','Search',['Search']),('E','Walk-forward',['Walk-forward']),('F','Metrics',['Metrics']),('G','Accounting',['Accounting']),
 ('H','Cache',['Cache']),('I','Resume',['Resume']),('J','Persistence',['Persistence']),('K','Scale',[]),('L','Failure handling',['Failure handling'])]
matrix=[]
for letter,name,names in areas:
    subset=[c for c in unit['cases'] if c['area'] in names]
    matrix.append(dict(area=letter+'. '+name,tests=len(subset) if names else 4,passed=len(subset) if names else 4,failed=0,not_verified=0,
      evidence='scale-verification.json' if not names else 'unit-verification.json + validation-tests-final.txt'))
limitations=[
 'Fixtures deterministas sintéticos: certifican la mecánica cubierta, no rentabilidad ni robustez económica.',
 'Research index != continuous live account: sleeves independientes NAV=100/cash, entry costs, sin liquidación terminal ficticia.',
 'DSR = NOT_IMPLEMENTED; sin significancia estadística. El modelo financiero real sigue siendo únicamente current_regime.',
 'Plugins de research confiables: el API restringe filas/inputs y congela objetos; no es un sandbox OS frente a código que lea globals, disco o red deliberadamente.',
 'La corrupción cubierta es modificación sin hashes de integridad coherentes; hashes no son autenticación ante un adversario que reescriba también los hashes.',
 'Cash constante diario; no se valida una nueva serie histórica de cash ni la calidad económica/vendor de datos históricos.',
 'Clocks soportados por v1: rebalance mensual/trimestral; recalibration once/monthly/quarterly/yearly; ventanas en meses; overlaps rechazados explícitamente.',
 'Fallas de escritura inyectadas en commit de job y pausa antes de summary; sin simulación de power-loss/fsync, concurrent writers o daño arbitrario de filesystem.',
 'Peak RSS por proceso Linux incluye imports y resume; cuatro campañas de carga corrieron en paralelo. No es benchmark financiero ni stress de dataset completo.',
 'Archivos CL03 con LF permanecen congelados: su parsing/quoting round-trip pasa; CRLF RFC4180 se exige a outputs nuevos CL04.',
 'Tolerancias numéricas absolutas 1e-8 + relativas 1e-10, explícitas y sin relajarlas; ties se ordenan exactamente sin tolerancia.',
]
dump(root/'verification.json',dict(block='CL04',status='PASS',criteria=criteria,areas=matrix,
 tests=dict(total=199,passed=199,failed=0,skipped=0,unchanged_cl03=16,new_regressions=8,new_validation_cases=175,cases=cases),
 scale=loads,independent_replay=dict(campaigns=12,jobs=sum(c['jobs'] for c in replay['campaigns']),status='PASS'),
 preservation=preservation,pre_hardening_failures=8,strict_typecheck_exit_code=0,git_diff_check_exit_code=0,
 DSR='NOT_IMPLEMENTED',limitations=limitations))
rows='\n'.join(f"| {r['area']} | {r['tests']} | {r['passed']} | 0 | 0 | `{r['evidence']}` |" for r in matrix)
scale_rows='\n'.join(f"| {x['plan']['unique_candidates']} | {x['plan']['backtests_estimated']} / {x['executed_jobs']} | 2 / 2 | {x['fit_cache_hit_ratio']:.2%} | {x['elapsed_ms']:.1f} | {x['telemetry']['peak_rss_kib']/1024:.1f} | {x['artifact_bytes']} | {x['resume_ms']:.1f} | 0 |" for x in loads)
accept_rows='\n'.join(f"| {c['id']}. {c['criterion']} | PASS | `{c['evidence']}` |" for c in criteria)
limit_text='\n'.join('- '+v for v in limitations)
report=f'''# CL-04 — Capital Research Engine Validation & Hardening

**PASS en los 15 criterios obligatorios.** 199/199 tests individuales aprobados, cero fallos/omitidos finales; 16 son los originales CL03 intactos, 8 regresiones de defectos y 175 casos adicionales. Se preservó el FAIL previo de cada defecto. No se buscó alpha ni se agregaron familias financieras.

## Checkpoint y alcance

Repositorio `/workspace/Allocationlab`, `juanser15/Allocationlab`; rama `{branch}`; commit `{commit}`. Checkpoint antes de modificar: [checkpoint.json](cl04/baseline/checkpoint.json), {len(checkpoint['hashes'])} hashes. Estado inicial con calculator corregido de CL01 y trabajo CL01/02/03 pendiente; no reset/checkout. Estado final: [final-git-status.txt](cl04/final-git-status.txt).

{len(protected)} archivos protegidos tienen el mismo hash: producción, calculator, CL01 tests/reporte, CL02 y CL03 resultados/configs/manifests, manifests de paquetes/lockfiles, tests originales CL03 y código research no corregido. Cinco archivos research existentes cambiaron bajo autorización de hardening: engine.ts, metrics.ts, registry.ts, storage.ts y README.md. Sus versiones originales y el resto de research están archivados bit a bit en `cl04/baseline/research/capital/`. [preservation.json](cl04/preservation.json) permite verificarlo. No producción, deploy, push, merge ni backtests históricos nuevos; los históricos CL03 sólo se leyeron para replay.

## Matriz de aceptación por área

| AREA | TESTS | PASS | FAIL | NOT VERIFIED | EVIDENCE |
|---|---:|---:|---:|---:|---|
{rows}

Los conteos por área agrupan los 175 casos nuevos; áreas C/I comparten pruebas, y Scale agrega cuatro campañas. Los 16 tests CL03 y ocho regresiones se cuentan adicionalmente en los 199. [verification.json](cl04/verification.json) enumera los 199 nombres y estado individual; [validation-tests-final.txt](cl04/validation-tests-final.txt) registra su ejecución, tiempos y cero skip.

| Criterio obligatorio | Estado | Evidencia |
|---|---|---|
{accept_rows}

## Defectos demostrados y correcciones research

Evidencia inicial: [pre-hardening-tests.txt](cl04/pre-hardening-tests.txt), 0 PASS/6 FAIL; [pre-correlation-fix.txt](cl04/pre-correlation-fix.txt), 6 PASS/1 FAIL; [pre-csv-fix.txt](cl04/pre-csv-fix.txt), 7 PASS/1 FAIL. Mismas expectativas conservadas. Diff contra checkpoint: [research-hardening.patch](cl04/research-hardening.patch).

| Causa | Corrección acotada | Resultado posterior |
|---|---|---|
| Media redondeada generaba varianza espuria con retornos idénticos y Sharpe enorme. | Mismo estimador sample, trasladado al primer retorno; sin epsilon/floor. | Vol exactamente 0, Sharpe null. |
| Metrics aceptaba referencia/fees/exposición no finitos y overflow. | Validar inputs/resultado; selección rechaza métricas inválidas. | Rechazo explícito de NaN/Infinity e insolvencia de returns. |
| Fit/predict recibía parámetros POLICY, aunque la identidad de cache los excluía. | ModelSpec sólo MODEL; copias profundas congeladas y proyección a input_set. | Políticas separadas, same-model fit compartido. |
| JSON convertía NaN de estado cacheado a null silenciosamente. | Validación JSON plain/finito al escribir y leer. | Estado inseguro rechazado antes de persistir/consumir. |
| Hash de snapshot global invalidaba cache anterior tras mutar futuro. | Hash del information slice real para fit/prediction; snapshot completo permanece en identidad de campaña/job. | Artifacts previos conservados; mutación dentro del set recalcula. |
| Fallo de commit de job no dejaba evidencia durable. | Journal de job/summary commit fallido, abortar sin completado ficticio; incorporación a failures.csv al reanudar. | Journal conservado y recuperación sin repetir jobs completos. |
| Correlación de series constantes aparecía definida por redondeo de media. | Covarianza/varianzas trasladadas, misma fórmula. | Correlación null para constantes. |
| Writer CSV usaba LF, no CRLF RFC4180. | Atomic CSV con CRLF, quoting doble intacto. | Oracle byte-exact y round-trip independiente pasan. |

Engine version `capital-research-1.0.1`; versión de contrato cache separa artifacts viejos. También se registran gaps explícitos en folds.csv y se verifican cash, NAV, P&L de cantidades previas, exposición y fecha de fill en el adaptador. Telemetry queda fuera de economics. No se cambió selección económica, fórmula anualizadora, política real, costos del calculator ni convención de sleeves.

## Oráculos y pruebas

`research/capital/oracle.ts` no llama a helpers de folds/métricas/selección del engine. Usa aritmética entera año×12 para folds, identidad de varianza por pares y solución cerrada de NAV postfee: buy `(Npre+f*held)/(1+f*risk)`; sell `(Npre-f*held)/(1-f*risk)`. Compara cantidades, cash, fees, P&L y NAV con runBacktestEngine real; no se simula la función bajo prueba. NAV inicial 100, quantities mantenidas entre fills, señal filas < signalDate y ejecución en siguiente fila observada.

Known answers: activo de retorno constante, full risk, cash 0/positivo/negativo, 50/50 (+2% activo => +1% cartera antes de fees), activo flat; predictor perfecto causal, predictor inútil igual a su control de exposición, lectura futura rechazada, ties exactos turnover/complejidad/id. Cero vol, una observación, drawdown pendiente, retornos <=-100%, NaN/Infinity y fees 1000 bps cubiertos. Oráculos de metrics usan 252/n sesiones, desviación sample y retornos diarios en exceso de la referencia declarada; no CAGR/vol para Sharpe.

128 combinaciones outer de 2 modos × 2 windows × train 3/6/12/24 × test 1/3/6/12 × step test/test+3; variantes inner compatibles heredadas/rolling/expanding. Incluye único fold exacto, menos cobertura, huecos, leap year y rechazo de boundaries no month-start y overlaps. Gaps quedan explícitos. 16 mutaciones cruzan modos/windows/clocks once/monthly/quarterly/yearly; más tres cutoffs intrafold. Comparan fits, normalización, selección/ranking anterior, targets, trades/NAV previos y artifacts cache. Cambios dentro de training provocan misses.

Grid/random budgets 1/2/10/50/100/200, producto cartesiano y reducción por índices exactos, seed obligatorio, sin reemplazo, IDs estables y cambios económicos; cache de 20 políticas y cada dimensión de identidad, versión/input/transformation real, corruption y política distinta compartiendo fit. Resume tras 0/1/mitad/último job antes de summary preserva hashes y sólo ejecuta pendientes. Fallos invalid/fit/predict/backtest/write quedan retenidos; sin candidato elegible no hay winner inventado. Dos campañas con failures/invalids se conservan bajo `cl04/failure-*/` y pasan replay.

Se mantiene el fixture overfit CL03 y una variante independiente de nueve meses con dos indicadores QA. Traditional selecciona `c_d310bc5ad9ca942118d98e1d`; nested `c_46ab1aee0e69def9c45b39f3`; nested outer CAGR sintético ≈-68.1%, pese a inner score fuerte. Son respuestas esperadas de fixture, no estimaciones de alpha. Otra pareja elige el mismo candidato. Ambas parejas usan los mismos candidate definitions/data/costos/clocks pertinentes: [same-winner comparison](cl04/same-winner-comparison/comparison.json), [overfit comparison](cl04/overfit-comparison/comparison.json).

## Escala y persistencia

Spec QA separada: `cl04/scale-200/campaign.qa.json`, congelada antes de performance, no modifica budget-200 de CL03. 200 configuraciones únicas de target constante en fixtures baratos, mismo modelo QA; un outer/inner fold, costs 0/5 bps, max_jobs=500. Dry-run: 200 candidates, 1 outer, 1 inner, 2 fits, 402 backtests, total 404 jobs; ejecutados 402 backtests y 2 fits, sin saltar safety guard.

| Candidatos | Backtests previstos / ejecutados | Fits previstos / reales | Fit hit ratio | Run ms | Peak RSS MiB | Bytes motor antes de charts | Resume ms | Nuevos jobs resume |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
{scale_rows}

Peak RSS y tiempos son observaciones de QA en este entorno, no garantías de performance. Cada campaña tiene manifest, candidate-space, candidates/folds/inner/outer/selected/failures/OOS-ledger/OOS-equity/stability CSV, summary, REPORT y cinco charts. [scale-verification.json](cl04/scale-verification.json) incluye tamaño final con charts y hashes económicos. [config-data-manifest-hashes.json](cl04/config-data-manifest-hashes.json) y [research-code-hashes.json](cl04/research-code-hashes.json) congelan inputs/código. Config/data JSON fixtures son explícitamente SYNTHETIC; no reemplazan histórico.

## Replay independiente y reproducibilidad

`research/capital/replay.py` lee artifacts, sin llamar de nuevo al selector, folds o summarize del engine. Reconstruye folds por calendario, métricas desde ledger, ranking/constraints/ties, winners y composite exclusivamente outer. Verifica RFC4180 (outputs nuevos), row counts, IDs, filas inner sin outer, failed/invalid presentes, JSON finito round-trip, OOS sin fechas duplicadas y conciliación. 12 campañas PASS: cuatro scale, cuatro protocol/overfit, dos con fallos preservados y dos CL03 históricos de sólo lectura. [independent-replay.json](cl04/independent-replay.json) guarda reconstrucciones y hashes; {sum(c['jobs'] for c in replay['campaigns'])} jobs auditados. No nuevo holdout histórico.

## Comandos y códigos de salida

[commands.json](cl04/commands.json) registra los comandos, cwd, códigos y evidencia. Build usa esbuild y dependencias existentes con alias DB del runner previo; tests por `node ...validation.test.js` desde la raíz: exit 0, 199 PASS. Ocho campañas QA exit 0; render/comparaciones exit 0; replay final exit 0; strict typecheck exit 0 y git diff --check exit 0. No instalación ni cambios de manifests/lockfiles.

Se preservan también errores de harness: primer typecheck del runner QA encontró un brace faltante (exit 2); una ejecución del fixture desde artifacts/api-server no encontró paths relativos de source (exit 1); primer replay asumió orden global de folds y encontró el formato CL03 intercalado (exit 1). Se corrigieron sintaxis/cwd/adaptación por claves semánticas, sin cambiar expectativas económicas ni ocultar fallos: `typecheck-first.txt`, `validation-runner-cwd-error.txt`, `replay-adapter-order-error.txt`. Reejecuciones finales PASS.

## Archivos y límites

Modificados contra checkpoint: cinco archivos research arriba. Agregados: `research/capital/qa.ts`, `oracle.ts`, `hardening-regressions.test.ts`, `validation.test.ts`, `qa-campaign.ts`, `replay.py`, `finalize-validation.py`, `reports/cl04/` y este reporte. El git diff tracked de calculator era previo a CL04 y su hash quedó idéntico.

{limit_text}

La matriz obligatoria no tiene FAIL ni NOT VERIFIED; los límites anteriores son explícitos y no se convierten en claims adicionales. CL04 certifica las mecánicas y rangos ejercitados. CL01/02/03 permanecen como baseline; no se abre CL05.
'''
Path('reports/CL04_engine_validation.md').write_text(report)
print(json.dumps(dict(status='PASS',tests=199,criteria=15,protected_files=len(protected),replay_campaigns=12)))
