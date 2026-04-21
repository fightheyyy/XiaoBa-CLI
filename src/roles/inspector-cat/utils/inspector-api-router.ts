import { Request, Response, Router } from 'express';
import { InspectorCaseStore } from './inspector-case-store';
import { Logger } from '../../../utils/logger';

interface MultipartPayload {
  fields: Record<string, string>;
  file?: {
    filename?: string;
    contentType?: string;
    content: Buffer;
  };
}

function assertInspectorApiKey(req: Request, res: Response): boolean {
  const requiredApiKey = process.env.INSPECTOR_SERVER_API_KEY?.trim();
  if (!requiredApiKey) {
    return true;
  }

  const providedApiKey = String(req.header('x-inspector-key') || '');
  if (providedApiKey !== requiredApiKey) {
    res.status(401).json({ error: 'invalid inspector api key' });
    return false;
  }

  return true;
}

function getMultipartBoundary(req: Request): string {
  const contentType = String(req.header('content-type') || '');
  const match = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  const boundary = match?.[1] || match?.[2];
  if (!boundary) {
    throw new Error('missing multipart boundary');
  }
  return boundary.trim();
}

async function readRequestBuffer(req: Request): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function parseMultipartRequest(req: Request): Promise<MultipartPayload> {
  const boundary = getMultipartBoundary(req);
  const raw = (await readRequestBuffer(req)).toString('latin1');
  const delimiter = `--${boundary}`;
  const sections = raw
    .split(delimiter)
    .slice(1, -1)
    .map(section => section.replace(/^\r\n/, '').replace(/\r\n$/, ''))
    .filter(Boolean);

  const fields: Record<string, string> = {};
  let file: MultipartPayload['file'];

  for (const section of sections) {
    const headerEnd = section.indexOf('\r\n\r\n');
    if (headerEnd < 0) {
      continue;
    }

    const headerText = section.slice(0, headerEnd);
    const bodyText = section.slice(headerEnd + 4).replace(/\r\n$/, '');
    const headerLines = headerText.split('\r\n');
    const disposition = headerLines.find(line => /^content-disposition:/i.test(line));
    if (!disposition) {
      continue;
    }

    const nameMatch = disposition.match(/name="([^"]+)"/i);
    const filenameMatch = disposition.match(/filename="([^"]*)"/i);
    const fieldName = nameMatch?.[1];
    if (!fieldName) {
      continue;
    }

    if (filenameMatch) {
      const contentType = headerLines
        .find(line => /^content-type:/i.test(line))
        ?.split(':')
        .slice(1)
        .join(':')
        .trim();
      file = {
        filename: filenameMatch[1] || undefined,
        contentType,
        content: Buffer.from(bodyText, 'latin1'),
      };
      continue;
    }

    fields[fieldName] = Buffer.from(bodyText, 'latin1').toString('utf-8');
  }

  return { fields, file };
}

export function createInspectorApiRouter(store: InspectorCaseStore = new InspectorCaseStore()): Router {
  const router = Router();

  router.post('/inspector/cases', async (req, res) => {
    try {
      if (!assertInspectorApiKey(req, res)) {
        return;
      }

      const {
        analysisType,
        source,
        userRequest,
        runtimeVersion,
        client,
        manifest,
        caseMarkdown,
        files,
      } = req.body || {};

      if (!analysisType || !['runtime', 'skill', 'auto'].includes(analysisType)) {
        return res.status(400).json({ error: 'analysisType must be one of: runtime, skill, auto' });
      }

      if (files !== undefined && !Array.isArray(files)) {
        return res.status(400).json({ error: 'files must be an array' });
      }

      const created = await store.createCase({
        analysisType,
        source,
        userRequest,
        runtimeVersion,
        client,
        manifest,
        caseMarkdown,
        files,
      });

      Logger.info(`[InspectorHook] onCaseReceived -> ${created.caseId} (${created.fileCount} files, type=${created.analysisType})`);

      res.status(201).json({
        ok: true,
        caseId: created.caseId,
        status: created.status,
        storedAt: created.storedPath,
        fileCount: created.fileCount,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/inspector/cases', async (req, res) => {
    try {
      const limit = Number(req.query.limit || 50);
      res.json(await store.listCases(limit));
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/inspector/cases/:caseId', async (req, res) => {
    try {
      const record = await store.getCase(req.params.caseId);
      if (!record) {
        return res.status(404).json({ error: 'case not found' });
      }
      res.json(record);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post('/inspector/cases/:caseId/files', async (req, res) => {
    try {
      if (!assertInspectorApiKey(req, res)) {
        return;
      }

      const { fields, file } = await parseMultipartRequest(req);
      const uploadPath = String(fields.path || '').trim();
      const kind = String(fields.kind || '').trim() || undefined;
      if (!uploadPath) {
        return res.status(400).json({ error: 'path is required' });
      }
      if (!file) {
        return res.status(400).json({ error: 'file is required' });
      }

      const updated = await store.appendFile(req.params.caseId, {
        path: uploadPath,
        kind: kind as 'runtime_log' | 'session_jsonl' | 'manifest' | 'case_markdown' | 'other' | undefined,
        content: file.content,
      });

      res.status(201).json({
        ok: true,
        caseId: updated.caseId,
        fileCount: updated.fileCount,
        uploadedPath: uploadPath,
      });
    } catch (e: any) {
      if (/Case not found/.test(e.message)) {
        return res.status(404).json({ error: e.message });
      }
      res.status(500).json({ error: e.message });
    }
  });

  router.post('/inspector/cases/:caseId/complete', async (req, res) => {
    try {
      if (!assertInspectorApiKey(req, res)) {
        return;
      }

      const updated = await store.completeCaseUpload(req.params.caseId);
      Logger.info(`[InspectorHook] case ready -> ${updated.caseId} (${updated.fileCount} files, type=${updated.analysisType})`);
      res.json({
        ok: true,
        caseId: updated.caseId,
        status: updated.status,
        fileCount: updated.fileCount,
      });
    } catch (e: any) {
      if (/Case not found/.test(e.message)) {
        return res.status(404).json({ error: e.message });
      }
      res.status(400).json({ error: e.message });
    }
  });

  router.post('/inspector/cases/:caseId/result', async (req, res) => {
    try {
      if (!assertInspectorApiKey(req, res)) {
        return;
      }

      const { status, result, resultSummary } = req.body || {};
      if (!status || !['processing', 'analyzed', 'failed'].includes(status)) {
        return res.status(400).json({ error: 'status must be one of: processing, analyzed, failed' });
      }

      const updated = await store.saveResult(req.params.caseId, status, result ?? {}, resultSummary);
      res.json({ ok: true, caseId: updated.caseId, status: updated.status });
    } catch (e: any) {
      if (/Case not found/.test(e.message)) {
        return res.status(404).json({ error: e.message });
      }
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/inspector/cases/:caseId/result', async (req, res) => {
    try {
      const record = await store.getCase(req.params.caseId);
      if (!record) {
        return res.status(404).json({ error: 'case not found' });
      }

      const result = await store.getResult(req.params.caseId);
      res.json({
        caseId: record.caseId,
        status: record.status,
        resultSummary: record.resultSummary,
        result,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
}
