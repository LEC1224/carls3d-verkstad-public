export function makeBoxFixture(subdivisions: number, [width, depth, height]: number[]) {
  const count = 12 * subdivisions * subdivisions;
  const buffer = Buffer.alloc(84 + count * 50);
  buffer.writeUInt32LE(count, 80);
  let offset = 84;
  const faces = [
    [[0,0,0],[0,depth,0],[width,0,0]],
    [[0,0,height],[width,0,0],[0,depth,0]],
    [[0,0,0],[width,0,0],[0,0,height]],
    [[0,depth,0],[0,0,height],[width,0,0]],
    [[0,0,0],[0,0,height],[0,depth,0]],
    [[width,0,0],[0,depth,0],[0,0,height]],
  ];
  for (const [origin,u,v] of faces) {
    const p = (i,j) => origin.map((value,k) => value + u[k]*i/subdivisions + v[k]*j/subdivisions);
    for (let i=0;i<subdivisions;i++) for (let j=0;j<subdivisions;j++) {
      const a=p(i,j), b=p(i+1,j), c=p(i+1,j+1), d=p(i,j+1);
      for (const triangle of [[a,b,c],[a,c,d]]) {
        for (let vertex=0;vertex<3;vertex++) for(let axis=0;axis<3;axis++) buffer.writeFloatLE(triangle[vertex][axis],offset+12+vertex*12+axis*4);
        offset+=50;
      }
    }
  }
  return buffer;
}
