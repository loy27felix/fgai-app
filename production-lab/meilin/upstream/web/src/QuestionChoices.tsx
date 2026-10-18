import { useId, useRef, useState } from "react";
import { Button, Input, Radio } from "antd";
import type { Studio } from "./api";

export function QuestionChoices({questions,disabled,onConfirm}:{
  questions:Studio["questions"];
  disabled:boolean;
  onConfirm:(text:string)=>Promise<boolean>;
}) {
  const [answers,setAnswers]=useState<Record<number,string>>({});
  const [sending,setSending]=useState(false);
  const [submitted,setSubmitted]=useState(false);
  const inFlight=useRef(false);
  const groupId=useId();
  const selected=questions.filter((q,i)=>q.options.length?q.options.includes(answers[i]):Boolean(answers[i]?.trim())).length;
  const ready=questions.length>0&&selected===questions.length;
  const confirm=async()=>{
    if(!ready||disabled||inFlight.current||submitted)return;
    inFlight.current=true;setSending(true);
    try {
      const text="已确认以下创作选择：\n\n"+questions.map((q,i)=>`${i+1}. ${q.question}\n我的选择：${answers[i]}`).join("\n\n");
      if(await onConfirm(text))setSubmitted(true);
    } finally {inFlight.current=false;setSending(false);}
  };
  return <section className="question-choices" aria-label="确认创作选择">
    {questions.map((q,index)=><div className="agent-question" key={`${q.id}:${index}`}>
      <p>{index+1}. {q.question}</p>
      {q.options.length?<Radio.Group name={`${groupId}-${index}`} aria-label={q.question} value={answers[index]} disabled={disabled||sending||submitted}
        onChange={e=>setAnswers(previous=>({...previous,[index]:e.target.value}))}>
        {q.options.map((answer,i)=><Radio.Button key={i} value={answer}>{answer}</Radio.Button>)}
      </Radio.Group>:<Input.TextArea aria-label={q.question} value={answers[index]||""} disabled={disabled||sending||submitted} onChange={e=>setAnswers(previous=>({...previous,[index]:e.target.value}))} autoSize={{minRows:2,maxRows:5}} placeholder="填写这一项的选择"/>}
    </div>)}
    <div className="question-confirm">
      <span role="status">{submitted?"已提交选择":`已选择 ${selected} / ${questions.length} 项`}</span>
      <Button type="primary" loading={sending} disabled={!ready||disabled||sending||submitted} onClick={()=>void confirm()}>确认并发送</Button>
      {!ready&&<small>每项选好后，一次提交给美林。</small>}
    </div>
  </section>;
}
