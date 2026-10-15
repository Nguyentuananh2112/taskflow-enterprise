// FIXTURE VI PHẠM CỐ Ý — dangerouslySetInnerHTML. Không sao chép vào code thật.
export function Html({ html }: { html: string }) {
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}
