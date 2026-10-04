import json,sys
from pathlib import Path
path=Path(sys.argv[1]);data=json.loads(path.read_text());scores=data['extra']['scores']
output=[]
for split in ['calibration','validation']:
 cases=[q for q in scores if q['split']==split]
 for k in [1,3,5]:
  for threshold in sorted(set([0.16,0.3]+[round(n/100,2) for n in range(0,86,2)])):
   tp=fp=fn=tn=wrong=0
   for q in cases:
    matches=[r for r in q['ranked'] if r['score']>=threshold][:k]
    if q['evidence']:
     good=all(any(e in r['content'] for r in matches) for e in q['evidence'])
     tp+=good;fn+=not good;wrong+=bool(matches) and not good
    else:fp+=bool(matches);tn+=not matches
   precision=tp/(tp+fp+wrong) if tp+fp+wrong else 0;recall=tp/(tp+fn) if tp+fn else 0
   output.append(dict(split=split,k=k,threshold=threshold,tp=tp,fp=fp,fn=fn,tn=tn,wrong=wrong,precision=precision,recall=recall,f1=2*precision*recall/(precision+recall) if precision+recall else 0))
best=max([r for r in output if r['split']=='calibration'],key=lambda r:(r['f1'],-r['fp'],-r['k']))
report={'selectedOnCalibration':best,'validationAtSelected':next(r for r in output if r['split']=='validation' and r['k']==best['k'] and r['threshold']==best['threshold']),'comparisons':output,'scores':[dict(id=q['id'],query=q['query'],split=q['split'],answerable=bool(q['evidence']),topScore=q['ranked'][0]['score'] if q['ranked'] else None) for q in scores]}
path.with_name(path.stem+'-thresholds.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
print(json.dumps({k:v for k,v in report.items() if k not in ['comparisons','scores']},ensure_ascii=False,indent=2))
print('Existing thresholds at topK3:')
for r in output:
 if r['threshold'] in [.16,.3] and r['k']==3:print(r)
