import { ArrowLeft, Building2, Scale, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

const OPERATOR_NAME = "深圳市公共城市安全研究院有限公司";
const CONTACT_MOBILE = "13556995290";
const CONTACT_LANDLINE = "0755-8812702";

interface LegalDocumentShellProps {
  title: string;
  icon: ReactNode;
  children: ReactNode;
}

function LegalDocumentShell({
  title,
  icon,
  children
}: LegalDocumentShellProps) {
  return (
    <div className="legal-page">
      <div className="legal-page-shell">
        <Link className="legal-back-link" to="/">
          <ArrowLeft aria-hidden="true" />
          返回平台首页
        </Link>
        <article className="legal-document">
          <header className="legal-document-heading">
            <span className="legal-document-heading-icon" aria-hidden="true">{icon}</span>
            <h1>{title}</h1>
          </header>
          {children}
        </article>
      </div>
    </div>
  );
}

function ContactBlock() {
  return (
    <div className="legal-contact-card">
      <Building2 aria-hidden="true" />
      <div>
        <strong>{OPERATOR_NAME}</strong>
        <span>个人信息保护与投诉联系电话</span>
        <div>
          <a href={`tel:${CONTACT_MOBILE}`}>{CONTACT_MOBILE}</a>
          <a href={`tel:${CONTACT_LANDLINE}`}>{CONTACT_LANDLINE}</a>
        </div>
      </div>
    </div>
  );
}

export function PrivacyPolicyPage() {
  return (
    <LegalDocumentShell
      title="隐私政策"
      icon={<ShieldCheck />}
    >
      <section>
        <h2>一、适用范围与处理主体</h2>
        <p>
          本政策适用于建筑外墙巡检智能报告平台的网页端、业务接口以及与账号、项目、照片检测和报告有关的服务。
          平台个人信息处理者为{OPERATOR_NAME}。我们按照合法、正当、必要和诚信原则处理个人信息，不会因您拒绝提供非必要信息而拒绝提供与该信息无关的基础功能。
        </p>
      </section>

      <section>
        <h2>二、我们处理的信息</h2>
        <div className="legal-table-wrap">
          <table>
            <thead>
              <tr><th>场景</th><th>信息类型</th><th>主要用途</th></tr>
            </thead>
            <tbody>
              <tr>
                <td>注册、登录和账号安全</td>
                <td>用户名、密码的不可逆哈希值、手机号、账号角色、登录时间；姓名和单位可在注册后自愿补充</td>
                <td>创建账号、核验身份、登录、安全防护、权限控制和联系服务</td>
              </tr>
              <tr>
                <td>检测工作台</td>
                <td>项目名称、项目地址、经纬度与建筑信息</td>
                <td>建立检测项目、定位建筑、安排检测和生成项目报告</td>
              </tr>
              <tr>
                <td>照片上传和检测</td>
                <td>原始照片、文件名、文件大小、类型、热成像识别所需的部分图片元数据、上传人和上传时间</td>
                <td>保存检测材料、区分可见光与热成像照片、执行缺陷识别和生成标注结果</td>
              </tr>
              <tr>
                <td>AI 推理和报告</td>
                <td>照片切片、检测类型、模型输出、缺陷框、人工复核记录、报告内容和导出记录</td>
                <td>识别疑似缺陷、支持人工复核、生成与交付检测结果</td>
              </tr>
              <tr>
                <td>位置与天气服务</td>
                <td>输入的地址、选择的建筑坐标、查询日期和立面朝向</td>
                <td>地图选点、地址搜索、天气查询和检测时段推荐</td>
              </tr>
              <tr>
                <td>运行安全与用量</td>
                <td>请求时间、接口状态、账号用量、照片数量、存储量、模型请求数和 Token 用量；浏览器中的登录令牌、主题和任务恢复标识</td>
                <td>保持登录、恢复任务、排查故障、限制滥用、统计资源消耗和保障系统安全</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          照片中的自然人、车牌、住户生活信息等可能属于他人的个人信息。上传此类信息前，
          您应确认具有合法处理依据，并尽量删除、遮挡与外墙检测无关的信息。
        </p>
      </section>

      <section>
        <h2>三、敏感个人信息</h2>
        <p>
          平台并不以识别人脸或追踪个人行踪为目的。照片若意外包含清晰人脸、个人住宅内部、车辆号牌，或者坐标能够与特定自然人的活动关联，
          可能产生较高个人权益风险。请优先裁剪或遮挡无关内容；确需处理时，我们会在相应功能处作显著提示，并按照适用规则取得单独同意或确认其他合法处理依据。
        </p>
      </section>

      <section>
        <h2>四、保存期限与删除</h2>
        <ul>
          <li>账号资料在账号存续期间保存。完成账号注销后，姓名、手机号和单位等账号资料将被匿名化，登录权限立即失效。</li>
          <li>未归档的体验照片保存至您主动删除或注销账号；已归档体验数据可通过检测结果管理或个人信息权利渠道申请删除。</li>
          <li>您在结果列表执行的普通“删除”可能先进入可恢复状态，而不是立即物理清除；如需不可恢复删除，请通过个人信息权利渠道提出。</li>
          <li>正式项目、审核记录和交付报告可能因履行合同、工程质量追溯、争议处理或法定义务而继续保存，期限按照实现对应目的所必需的最短时间确定。</li>
          <li>用量与安全记录按照审计、结算和安全防护所需期限保存；注销后将解除其与已注销账号资料的直接关联。</li>
          <li>备份中的数据将在备份轮换周期内被覆盖，期间仅用于灾难恢复，不用于其他业务处理。</li>
        </ul>
      </section>

      <section>
        <h2>五、您的权利</h2>
        <p>
          您可以在“个人信息”中查阅和更正账号资料、下载个人数据副本、修改密码或申请注销账号。
          您还可以要求补充、更正、复制、删除或限制处理相关个人信息，或者撤回基于同意开展的处理。
          撤回同意不影响撤回前处理活动的效力；必要信息被删除后，对应功能可能无法继续使用。
        </p>
        <p>
          对于无法在页面自行完成的请求，请通过本政策列明的电话联系我们。我们会核验请求人身份并在法律规定的期限内处理；
          涉及他人权益、法定保存义务或工程交付记录时，我们会说明无法立即删除的原因和后续处理方式。
        </p>
      </section>

      <section>
        <h2>六、信息安全</h2>
        <p>
          我们采取访问控制、身份认证、传输加密、密码哈希、操作权限隔离、对象访问签名、备份和安全事件处置措施。
          如发生可能危害您权益的个人信息安全事件，我们会依法采取补救措施，并通过电话、短信、站内公告或其他可用方式告知事件情况和应对建议。
        </p>
      </section>

      <section>
        <h2>七、未成年人</h2>
        <p>
          本平台面向具备工程检测或项目管理职责的成年用户，不以不满十四周岁的未成年人为目标用户。
          如您发现平台在缺乏监护人同意的情况下处理了未成年人个人信息，请立即联系我们，我们将核实并依法处理。
        </p>
      </section>

      <section>
        <h2>八、政策更新与联系我们</h2>
        <p>
          我们可能根据功能或法律要求更新本政策。涉及处理目的、方式、信息种类、保存期限或接收方的重大变化时，
          我们会通过醒目提示向您说明；依法需要重新同意的，将在继续处理前重新取得同意。
        </p>
        <ContactBlock />
      </section>
    </LegalDocumentShell>
  );
}

export function TermsPage() {
  return (
    <LegalDocumentShell
      title="用户服务协议"
      icon={<Scale />}
    >
      <section>
        <h2>一、协议主体与生效</h2>
        <p>
          本协议由您与{OPERATOR_NAME}共同订立。您注册账号、勾选同意或实际使用平台服务，即表示您已经阅读并同意本协议。
          如您代表单位使用平台，应确保已获得相应授权。
        </p>
      </section>

      <section>
        <h2>二、服务内容</h2>
        <p>
          平台提供外墙检测项目管理、照片上传、AI 辅助缺陷识别、人工复核、检测时段推荐及报告生成、查看和导出功能。
          具体功能会因账号角色、系统配置和服务状态而不同。
        </p>
      </section>

      <section>
        <h2>三、账号与安全</h2>
        <ul>
          <li>您应提供真实、准确、必要的注册信息，并及时更新发生变化的信息。</li>
          <li>账号仅限获授权人员使用。您应妥善保管密码，不得共享、转让或出租账号。</li>
          <li>发现账号被冒用或存在安全风险时，请立即修改密码并联系平台。</li>
          <li>平台可以对异常登录、批量请求、恶意上传或其他危害安全的行为采取限制、暂停或终止措施。</li>
        </ul>
      </section>

      <section>
        <h2>四、上传内容与第三方权益</h2>
        <ul>
          <li>您应确保对上传的照片和项目资料具有合法使用权限。</li>
          <li>请勿上传与外墙检测无关的人脸、个人住宅内部、车牌、身份证件、联系方式或其他个人信息。</li>
          <li>不得上传违法内容、恶意程序、侵犯知识产权、商业秘密、隐私权、肖像权或其他合法权益的内容。</li>
          <li>为提供检测服务，您授权平台在必要范围内存储、切片、转换、分析和生成标注图及报告；该授权不改变上传内容原有权利归属。</li>
        </ul>
      </section>

      <section>
        <h2>五、AI 检测结果</h2>
        <p>
          AI 输出用于辅助发现疑似外墙缺陷，受照片质量、拍摄角度、遮挡、模型能力和系统配置影响，可能出现误检、漏检或分类偏差。
          检测结果不能替代现场勘查、专业鉴定、结构安全评估或依法应由具备资质人员作出的结论。
          涉及人员和财产安全的决定应由专业人员结合现场情况作出。
        </p>
      </section>

      <section>
        <h2>六、报告使用</h2>
        <p>
          您下载、打印或向他人提供报告前，应确认接收范围合法、必要，
          并采取访问控制、脱敏和安全传输措施。因您超出授权范围传播报告造成的后果，由您依法承担。
        </p>
      </section>

      <section>
        <h2>七、服务变更与中断</h2>
        <p>
          平台可能因维护、升级、网络故障、第三方服务异常或不可抗力暂时中断部分功能。我们会在合理范围内恢复服务并保存已完成的业务记录。
          对用户权益有重大影响的功能或规则变化，我们会以合理方式提前说明。
        </p>
      </section>

      <section>
        <h2>八、个人信息保护与账号注销</h2>
        <p>
          我们按照<Link to="/privacy">《隐私政策》</Link>处理个人信息。您可以在个人信息页面申请下载数据副本或注销账号。
          注销前请自行保存所需报告；依法或因工程交付、争议处理需要保留的记录，将在必要期限内限制用途并受到安全保护。
        </p>
      </section>

    </LegalDocumentShell>
  );
}
