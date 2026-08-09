import { Injectable } from "@nestjs/common";
import { CreateBucketCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

@Injectable()
export class ObjectStoreService {
  private readonly bucket = process.env.S3_BUCKET || "raw-snapshots";
  private readonly client = new S3Client({
    endpoint: process.env.S3_ENDPOINT || "http://localhost:9000",
    region: "us-east-1",
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY || "aicard",
      secretAccessKey: process.env.S3_SECRET_KEY || "change-me",
    },
  });
  private bucketReady?: Promise<void>;

  async put(key: string, body: string | Uint8Array, contentType: string) {
    await this.ensureBucket();
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }));
    return key;
  }

  async getText(key: string) {
    const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!response.Body) throw new Error("Snapshot body is missing");
    return response.Body.transformToString("utf-8");
  }

  async getBinary(key: string) {
    const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!response.Body) throw new Error("Object body is missing");
    return {
      body: Buffer.from(await response.Body.transformToByteArray()),
      contentType: response.ContentType || "application/octet-stream",
      etag: response.ETag,
    };
  }

  private ensureBucket() {
    if (!this.bucketReady) {
      this.bucketReady = this.client.send(new CreateBucketCommand({ Bucket: this.bucket }))
        .then(() => undefined)
        .catch((error: { name?: string }) => {
          if (!["BucketAlreadyOwnedByYou", "BucketAlreadyExists"].includes(error.name || "")) throw error;
        });
    }
    return this.bucketReady;
  }
}
